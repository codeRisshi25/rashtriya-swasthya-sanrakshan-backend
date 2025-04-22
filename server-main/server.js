const app = require('./app');
const { generateAccessToken } = require('./services/tokenService');

const PORT = process.env.PORT || 4505;

// Generate the access token when the server starts
(async () => {
  try {
    await generateAccessToken();
    app.listen(PORT, () => {
      console.log(`Express app listening at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize access token:", error.message);
    process.exit(1); 
  }
})();