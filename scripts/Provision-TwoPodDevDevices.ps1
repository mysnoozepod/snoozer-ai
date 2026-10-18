param(
  [string]$Region = "us-east-1",
  [string]$Environment = "dev",
  [string]$StoreId = "severn-pilot",
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

if ($Environment -ne "dev") {
  throw "This commissioning script is intentionally restricted to the dev environment."
}

if (-not $OutputRoot) {
  $OutputRoot = Join-Path $env:USERPROFILE ".mysnoozepod\iot\dev\$StoreId"
}

$accountId = aws sts get-caller-identity --query Account --output text
if (-not $accountId) { throw "Unable to resolve AWS account." }
$endpoint = aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text --region $Region
if (-not $endpoint) { throw "Unable to resolve AWS IoT Data endpoint." }

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$rootCaPath = Join-Path $OutputRoot "AmazonRootCA1.pem"
if (-not (Test-Path -LiteralPath $rootCaPath)) {
  Invoke-WebRequest -Uri "https://www.amazontrust.com/repository/AmazonRootCA1.pem" -OutFile $rootCaPath
}

$results = @()
foreach ($podNumber in 1, 2) {
  $podId = "pod-$podNumber"
  $deviceId = "$podId-edge-01"
  $thingName = "msp-$Environment-$StoreId-$deviceId"
  $policyName = "$thingName-policy"
  $deviceDir = Join-Path $OutputRoot $deviceId
  New-Item -ItemType Directory -Force -Path $deviceDir | Out-Null
  $manifestPath = Join-Path $deviceDir "commissioning-manifest.json"

  $thingExists = $true
  aws iot describe-thing --thing-name $thingName --region $Region --output json *> $null
  if ($LASTEXITCODE -ne 0) { $thingExists = $false }
  if (-not $thingExists) {
    aws iot create-thing --thing-name $thingName --attribute-payload "attributes={environment=$Environment,storeId=$StoreId,zoneId=$podId},merge=false" --region $Region --output json | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Thing creation failed for $thingName" }
  }

  $topicPrefix = "arn:aws:iot:${Region}:${accountId}:topic/mysnoozepod/$Environment/stores/$StoreId"
  $policyDocument = @{
    Version = "2012-10-17"
    Statement = @(
      @{
        Effect = "Allow"
        Action = "iot:Connect"
        Resource = "arn:aws:iot:${Region}:${accountId}:client/$thingName"
      },
      @{
        Effect = "Allow"
        Action = "iot:Publish"
        Resource = @(
          "$topicPrefix/zones/$podId/events",
          "$topicPrefix/devices/$deviceId/heartbeat",
          "$topicPrefix/devices/$deviceId/fault",
          "$topicPrefix/devices/$deviceId/status",
          "$topicPrefix/devices/$deviceId/ack",
          "$topicPrefix/devices/$deviceId/reported-state"
        )
      },
      @{
        Effect = "Allow"
        Action = "iot:Subscribe"
        Resource = "arn:aws:iot:${Region}:${accountId}:topicfilter/mysnoozepod/$Environment/stores/$StoreId/devices/$deviceId/commands"
      },
      @{
        Effect = "Allow"
        Action = "iot:Receive"
        Resource = "$topicPrefix/devices/$deviceId/commands"
      }
    )
  } | ConvertTo-Json -Depth 8 -Compress

  $policyPath = Join-Path $deviceDir "policy.json"
  [System.IO.File]::WriteAllText($policyPath, $policyDocument, [System.Text.UTF8Encoding]::new($false))
  aws iot get-policy --policy-name $policyName --region $Region --output json *> $null
  if ($LASTEXITCODE -ne 0) {
    aws iot create-policy --policy-name $policyName --policy-document "file://$($policyPath.Replace('\','/'))" --region $Region --output json | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Policy creation failed for $policyName" }
  }

  $principalsRaw = aws iot list-thing-principals --thing-name $thingName --region $Region --output json
  $principals = @((($principalsRaw | ConvertFrom-Json).principals))
  $certificateArn = $principals | Where-Object { $_ -match ":cert/" } | Select-Object -First 1
  $certificateCreated = $false
  if (-not $certificateArn -and (Test-Path -LiteralPath $manifestPath)) {
    $existingManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $existingPrivateKey = Join-Path $deviceDir "device-private.pem.key"
    if ($existingManifest.certificateArn -and (Test-Path -LiteralPath $existingPrivateKey)) {
      $certificateArn = [string]$existingManifest.certificateArn
    }
  }
  if (-not $certificateArn) {
    $certPath = Join-Path $deviceDir "device-certificate.pem.crt"
    $publicKeyPath = Join-Path $deviceDir "device-public.pem.key"
    $privateKeyPath = Join-Path $deviceDir "device-private.pem.key"
    $createdRaw = aws iot create-keys-and-certificate --set-as-active --certificate-pem-outfile $certPath --public-key-outfile $publicKeyPath --private-key-outfile $privateKeyPath --region $Region --output json
    if ($LASTEXITCODE -ne 0) { throw "Certificate creation failed for $thingName" }
    $created = $createdRaw | ConvertFrom-Json
    $certificateArn = $created.certificateArn
    $certificateCreated = $true
    icacls $privateKeyPath /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(R,W)" *> $null
  }

  aws iot attach-thing-principal --thing-name $thingName --principal $certificateArn --region $Region --output json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Thing principal attachment failed for $thingName" }
  aws iot attach-policy --policy-name $policyName --target $certificateArn --region $Region --output json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Policy attachment failed for $thingName" }

  $verifiedPrincipals = @(((aws iot list-thing-principals --thing-name $thingName --region $Region --output json | ConvertFrom-Json).principals))
  if ($verifiedPrincipals -notcontains $certificateArn) { throw "Certificate verification failed for $thingName" }
  $verifiedPolicies = @(((aws iot list-attached-policies --target $certificateArn --region $Region --output json | ConvertFrom-Json).policies).policyName)
  if ($verifiedPolicies -notcontains $policyName) { throw "Policy verification failed for $thingName" }
  $certificateId = ($certificateArn -split "/")[-1]
  $certificateStatus = aws iot describe-certificate --certificate-id $certificateId --region $Region --query certificateDescription.status --output text
  if ($certificateStatus -ne "ACTIVE") { throw "Certificate is not active for $thingName" }

  $manifest = [ordered]@{
    environment = $Environment
    storeId = $StoreId
    podId = $podId
    deviceId = $deviceId
    thingName = $thingName
    policyName = $policyName
    certificateId = $certificateId
    certificateArn = $certificateArn
    endpoint = $endpoint
    credentialDirectory = $deviceDir
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
  $results += [pscustomobject]@{
    podId = $podId
    thingName = $thingName
    policyName = $policyName
    certificateId = $certificateId
    certificateCreated = $certificateCreated
    credentialDirectory = $deviceDir
  }
}

[pscustomobject]@{
  ok = $true
  environment = $Environment
  storeId = $StoreId
  endpoint = $endpoint
  credentialRoot = $OutputRoot
  devices = $results
} | ConvertTo-Json -Depth 6
