const express = require("express");
const { revokeAccess, grantAccess, retrieveDoctors } = require("../controllers/accessController");

const router = express.Router();

router.post("/grant", grantAccess);
router.post("/revoke", revokeAccess);

// Support both URL parameter and query parameter
router.get("/doctors/:uid", retrieveDoctors);
router.get("/doctors", retrieveDoctors); // Add this line for query parameter support

module.exports = router;