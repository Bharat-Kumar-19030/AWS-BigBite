module.exports = {
  apps: [
    {
      name: "bigbite-backend",
      script: "./server.js",
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
