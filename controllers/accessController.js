// Fix the import to match the exported function name from the service
const { retrieveDoctors: retrieveDoctorsService } = require('../services/accessControlService');
const firebaseConfig = require("../config/firebaseConfig.js");

// Controller for retrieving doctors
const retrieveDoctors = async (req, res) => {
  try {
    // Log incoming request for debugging
    console.log("🔍 Doctor access request received:", {
      params: req.params,
      query: req.query,
      path: req.path
    });
    
    // Get the user ID from the route parameter or query parameter
    const userID = req.params.uid || req.query.uid;
    
    if (!userID) {
      console.log("❌ Missing user ID in request");
      return res.status(400).json({
        success: false,
        message: "Missing user ID parameter"
      });
    }
    
    console.log(`📋 Retrieving doctors for user: ${userID}`);
    
    // Call the service function to get the doctors
    const doctors = await retrieveDoctorsService(userID);
    
    console.log(`✅ Found ${doctors.length} doctors for user ${userID}`);
    
    // Return the doctors as a JSON response
    return res.status(200).json({
      success: true,
      doctors: doctors
    });
  } catch (error) {
    console.error("❌ Error retrieving doctors:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve doctors",
      error: error.message
    });
  }
};

// Placeholder for grant access function
const grantAccess = async (req, res) => {
  try {
    // Implementation will go here
    res.status(200).json({ success: true, message: "Access granted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Placeholder for revoke access function
const revokeAccess = async (req, res) => {
  try {
    // Implementation will go here
    res.status(200).json({ success: true, message: "Access revoked" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  retrieveDoctors,
  grantAccess,
  revokeAccess
};