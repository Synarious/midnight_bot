# Use an official Node.js runtime as a parent image
# Using '-alpine' is a good practice for smaller image sizes
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install app dependencies using npm ci for faster, reliable builds
RUN npm ci --only=production

# Install PostgreSQL client tools (pg_dump) for backups. On Alpine this is provided
# by the postgresql-client package. Keep image small and avoid cache.
RUN apk add --no-cache postgresql-client

# Copy the rest of your application's code into the container
COPY . .

# Ensure the runtime check script is executable (optional)
RUN chmod +x ./scripts/check_runtime.js || true

# Use npm start so prestart hooks run (which execute the runtime check)
CMD ["npm", "start"]