# Use the official AWS Lambda Node.js 18 image
FROM public.ecr.aws/lambda/nodejs:18

# Set the working directory inside the container
WORKDIR /var/task

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install --production

# Copy the rest of your application files
COPY . .

# Command to start the Lambda function
CMD ["app.lambdaHandler"]
