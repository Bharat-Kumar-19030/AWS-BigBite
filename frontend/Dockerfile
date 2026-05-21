# Stage 1: Build the React Application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# We need to pass the Vite variables during the build process
ARG VITE_API_URL
ARG VITE_SERVER_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL

# Build the Vite app
RUN npm run build

# Stage 2: Serve with NGINX
FROM nginx:alpine

# Remove the default Nginx configuration
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom Nginx config for the container
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built React files from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
