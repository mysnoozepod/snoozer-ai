$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'docs\p1-007\PRODUCT_MEDIA_LIBRARY.json'
$outputPath = Join-Path $root 'docs\p1-007\FAILED_MEDIA_RENDITIONS.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$failedAlts = @(
  '2.5-Inch Gel Memory Foam Topper feature detail 3',
  'Carlisle Upholstered Headboard in a bedroom setting 4',
  'BEDGEAR Dri-Tec mattress protector fitted to a bed',
  'BEDGEAR Dri-Tec sheets in Light Grey on a bed',
  'BEDGEAR Dri-Tec Light Grey sheets in a bedroom',
  'BEDGEAR H6 hybrid mattress angle view',
  'BEDGEAR S7 mattress shown at an angle',
  'BEDGEAR S7 mattress corner and cover detail',
  'BEDGEAR Ver-Tex mattress protector fitted to a bed',
  'BEDGEAR Ver-Tex White sheets in a bedroom',
  'BEDGEAR Ver-Tex Light Grey split-head sheets'
)

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
$encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
  [System.Drawing.Imaging.Encoder]::Quality,
  [long]88
)
$records = @()

foreach ($product in $manifest.products) {
  foreach ($asset in $product.supportingImageOrder) {
    if ($failedAlts -notcontains $asset.alt) { continue }

    $sourcePath = [string]$asset.localPath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Archived source is missing: $sourcePath"
    }
    $outputDirectory = Join-Path $manifest.privateAssetRoot "optimized\$($product.handle)"
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension([string]$asset.fileName)
    $targetPath = Join-Path $outputDirectory "$baseName-shopify.jpg"

    $sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
    try {
      $scale = [Math]::Min(1.0, 4000.0 / [Math]::Max($sourceImage.Width, $sourceImage.Height))
      $width = [Math]::Max(1, [int][Math]::Round($sourceImage.Width * $scale))
      $height = [Math]::Max(1, [int][Math]::Round($sourceImage.Height * $scale))
      $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      try {
        $bitmap.SetResolution(72, 72)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.Clear([System.Drawing.Color]::White)
          $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $graphics.DrawImage($sourceImage, 0, 0, $width, $height)
        }
        finally {
          $graphics.Dispose()
        }
        $bitmap.Save($targetPath, $jpegCodec, $encoderParameters)
      }
      finally {
        $bitmap.Dispose()
      }
    }
    finally {
      $sourceImage.Dispose()
    }

    $file = Get-Item -LiteralPath $targetPath
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetPath).Hash.ToLowerInvariant()
    $records += [pscustomobject]@{
      handle = $product.handle
      shopifyProductId = $product.shopifyProductId
      sourceAssetId = $asset.sourceId
      alt = $asset.alt
      originalPath = $sourcePath
      optimizedPath = $targetPath
      fileName = $file.Name
      mimeType = 'image/jpeg'
      width = $width
      height = $height
      bytes = $file.Length
      sha256 = $hash
    }
    Write-Output "Optimized $($product.handle): $($asset.alt) -> ${width}x${height}, $($file.Length) bytes"
  }
}

if ($records.Count -ne $failedAlts.Count) {
  throw "Expected $($failedAlts.Count) failed media records, created $($records.Count)."
}

$payload = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  purpose = 'Shopify-safe staged-upload renditions for sources rejected during asynchronous media processing.'
  records = $records
}
$payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Output "Wrote $outputPath"
