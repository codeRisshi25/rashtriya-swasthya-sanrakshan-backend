const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const fs = require("fs");

// Load environment variables
dotenv.config();

// Function to generate a new access token
const generateAccessToken = async () => {
  const url = "https://api.sandbox.co.in/authenticate";
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": process.env.API_KEY,
    "x-api-secret": process.env.API_SECRET,
    "x-api-version": "1.0",
  };

  try {
    console.log("Generating access token...");
    const response = await axios.post(url, {}, { headers });
    const responseData = response.data;

    if (response.status === 200 && responseData.access_token) {
      const newAccessToken = responseData.access_token;
      console.log("Access token generated successfully:", newAccessToken);

      // Update the .env file with the new access token
      updateEnvFile("ACCESS_TOKEN", newAccessToken);

      return newAccessToken;
    } else {
      console.error(
        "Failed to generate access token:",
        responseData.message || "Unknown error"
      );
      throw new Error(
        responseData.message || "Failed to generate access token"
      );
    }
  } catch (error) {
    console.error("Error generating access token:", error.message);
    throw error;
  }
};

// Function to update the .env file
const updateEnvFile = (key, value) => {
  const envFilePath = "./.env";
  let envContent = fs.readFileSync(envFilePath, "utf8");

  const keyRegex = new RegExp(`^${key}=.*`, "m");
  if (keyRegex.test(envContent)) {
    // Replace the existing key-value pair
    envContent = envContent.replace(keyRegex, `${key}=${value}`);
  } else {
    // Add the new key-value pair
    envContent += `\n${key}=${value}`;
  }

  fs.writeFileSync(envFilePath, envContent, "utf8");
  console.log(`Updated ${key} in .env file.`);
};

// Generate the access token when the server starts
(async () => {
  try {
    await generateAccessToken();
  } catch (error) {
    console.error("Failed to initialize access token:", error.message);
    process.exit(1); // Exit the process if token generation fails
  }
})();

// Initialize Firebase Admin SDK
const serviceAccount = require("../project-charak-firebase-adminsdk-fbsvc-d9521be673.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 4505;

app.use(cors());
app.use(express.json());

// Global storage for user data during registration flow
const userDataStore = {};

// Helper function to get current timestamp
const getCurrentTimestamp = () => Math.floor(Date.now() / 1000);

// Route to send OTP
app.post("/send-otp", async (req, res) => {
  const { aadhaarId, password } = req.body;

  if (!aadhaarId || aadhaarId.length !== 12 || !/^\d+$/.test(aadhaarId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Aadhaar number" });
  }

  userDataStore[aadhaarId] = {
    password,
    timestamp: getCurrentTimestamp(),
  };

  const url = "https://api.sandbox.co.in/kyc/aadhaar/okyc/otp";
  const headers = {
    Authorization: process.env.ACCESS_TOKEN,
    "x-api-key": process.env.API_KEY,
    "x-api-version": "2.0",
    "Content-Type": "application/json",
  };
  const payload = {
    "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.request",
    aadhaar_number: aadhaarId,
    consent: "y",
    reason: "For KYC",
  };

  try {
    const response = await axios.post(url, payload, { headers });
    const { data } = response.data;

    if (response.status === 200 && data?.reference_id) {
      userDataStore[aadhaarId].reference_id = data.reference_id;
      return res.json({
        success: true,
        reference_id: data.reference_id,
        aadhaarId,
      });
    } else {
      return res
        .status(response.status)
        .json({
          success: false,
          message: response.data.message || "Failed to send OTP",
        });
    }
  } catch (error) {
    console.error("Error in /send-otp:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

// Route to verify OTP
app.post("/verify-otp", async (req, res) => {
  const { otp, reference_id } = req.body;

  const aadharNumber =
    Object.keys(userDataStore).find(
      (key) => userDataStore[key].reference_id === reference_id
    );

  if (!aadharNumber || !userDataStore[aadharNumber]) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Session expired, please restart the verification process",
      });
  }

  if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid OTP" });
  }

  const url = "https://api.sandbox.co.in/kyc/aadhaar/okyc/otp/verify";
  const headers = {
    Authorization: process.env.ACCESS_TOKEN,
    "x-api-key": process.env.API_KEY,
    "x-api-version": "2.0",
    "Content-Type": "application/json",
  };
  const payload = {
    "@entity": "in.co.sandbox.kyc.aadhaar.okyc.request",
    reference_id:String(reference_id),
    otp:String(otp),
  };

  try {
    const response = await axios.post(url, payload, { headers });
    const { data } = response.data;

    if (response.status === 200) {
      userDataStore[aadharNumber].otp_verification_data = data;
      return res.json({
        success: true,
        message: "OTP verified successfully",
        name: data.name,
        gender: data.gender,
        dob: data.date_of_birth,
        address: data.full_address,
        photo: data.photo,
      });
    } else {
      return res
        .status(response.status)
        .json({
          success: false,
          message: response.data.message || "Failed to verify OTP",
        });
    }
  } catch (error) {
    console.error("Error in /verify-otp:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

// Route to register user
app.post("/register-user", async (req, res) => {
  const data = req.body;

  const latestAadhar = Object.keys(userDataStore).reduce((latest, key) => {
    const user = userDataStore[key];
    if (
      user.otp_verification_data &&
      user.timestamp > (userDataStore[latest]?.timestamp || 0)
    ) {
      return key;
    }
    return latest;
  }, null);

  if (!latestAadhar || !userDataStore[latestAadhar]) {
    return res
      .status(400)
      .json({
        success: false,
        message: "No verification data found. Please complete verification first.",
      });
  }

  const userInfo = userDataStore[latestAadhar];
  const verificationData = userInfo.otp_verification_data;
  const password = userInfo.password;

  const userId = crypto
    .createHash("sha256")
    .update(latestAadhar + password)
    .digest("hex")
    .substring(0, 10);

  const userData = {
    id: userId,
    aadharId: latestAadhar,
    password: crypto
      .createHash("sha256")
      .update(password)
      .digest("hex"),
    name: verificationData.name,
    gender: verificationData.gender,
    dob: verificationData.date_of_birth,
    address: verificationData.full_address,
    photoUrl: verificationData.photo,
    role: "patient",
    height: data.height || "",
    weight: data.weight || "",
    contact: data.emergencyContact || "",
    age: data.age || "",
    currentMedications: data.medications || "",
    medicalDetails: {
      bloodGroup: data.bloodType || "",
      allergies: Array.isArray(data.allergiesDetails)
        ? data.allergiesDetails
        : (data.allergiesDetails || "")
            .split(",")
            .map((a) => a.trim()),
      emergencyContact: data.emergencyContact || "",
    },
    medicalHistory: data.conditions || [],
    vaccinationHistory: data.vaccines || [],
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const docRef = db.collection("patients").doc(userId);
    const doc = await docRef.get();

    if (doc.exists) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }

    await docRef.set(userData);

    delete userDataStore[latestAadhar];

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: { id: userId, name: userData.name, role: "patient" },
    });
  } catch (error) {
    console.error("Error saving user to Firestore:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to register user" });
  }
});

// Function to get user data
const getUserData = async (userID, role, password) => {
    try {
      // Validate inputs
      if (!userID || !role || !password) {
        throw new Error("Missing required parameters: userID, role, or password");
      }
  
      // Log the input parameters for debugging
      console.log(`Attempting login: userID=${userID}, role=${role}`);
  
      // Hash userID and password to generate user_id
      const hash = crypto.createHash("sha256");
      hash.update(userID + password, "utf8");
      const user_id = hash.digest("hex").substring(0, 10);
      console.log(`Generated user_id: ${user_id}`);
  
      // Fetch user document from Firestore
      const doc = await db.collection(role).doc(user_id).get();
      if (!doc.exists) {
        console.log(`No document found for userID: ${user_id} in role: ${role}`);
  
        // Try to find by aadharId (alternative lookup)
        console.log(`Trying alternative lookup by aadharId: ${userID}`);
        const querySnapshot = await db
          .collection(role)
          .where("aadharId", "==", userID)
          .limit(1)
          .get();
  
        if (querySnapshot.empty) {
          console.log(`No document found with aadharId: ${userID}`);
          return null;
        }
  
        // Use the first matching document
        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();
  
        // Verify password
        const storedPassword = userData.password || "";
        const hashedInputPassword = crypto
          .createHash("sha256")
          .update(password, "utf8")
          .digest("hex");
  
        if (storedPassword !== hashedInputPassword) {
          console.log(`Wrong password for aadharId: ${userID} in role: ${role}`);
          return null;
        }
  
        // Remove sensitive data before returning
        const { password: _, ...userDataWithoutPassword } = userData;
        return userDataWithoutPassword;
      }
  
      const userData = doc.data();
  
      // Verify password
      const storedPassword = userData.password || "";
      const hashedInputPassword = crypto
        .createHash("sha256")
        .update(password, "utf8")
        .digest("hex");
  
      if (storedPassword !== hashedInputPassword) {
        console.log(`Wrong password for userID: ${user_id} in role: ${role}`);
        return null;
      }
  
      // Remove sensitive data before returning
      const { password: _, ...userDataWithoutPassword } = userData;
      return userDataWithoutPassword;
    } catch (e) {
      console.error(`Error during login: ${e.message}`);
      return null;
    }
  };
  
  // get the doctors
  app.get("/api/doctors", async (req, res) => {
    try {
      const snap = await db.collection("doctors").get();
      const doctors = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      res.json(doctors);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  
  app.post("/auth/login", (req, res) => {
    try {
      const data = req.body; // Changed from req.data to req.body
      console.log("[ Login data from Client ] : ", data);
  
      if (!data) {
        return res.status(400).json({
          success: false,
          message: "Invalid request",
        });
      }
  
      // Getting the required data from the request
      const userID = data.userID; // Changed from data.get('userID')
      const role = data.role; // Fixed from data.get('password')
      const password = data.password;
  
      const valid_roles = ["patients", "doctors", "government"];
      if (!valid_roles.includes(role)) {
        // Fixed array membership check
        return res.status(400).json({
          success: false,
          message: "Invalid role",
        });
      }
  
      getUserData(userID, role, password)
        .then((userData) => {
          if (userData) {
            res.status(200).json({
              success: true,
              message: "Login successful",
              data: userData,
            });
          } else {
            res.status(401).json({
              success: false,
              message: "Invalid credentials",
            });
          }
        })
        .catch((error) => {
          console.error("Error while fetching user data: ", error);
          res.status(500).json({
            success: false,
            message: "Internal server error",
          });
        });
    } catch (e) {
      console.log("Error while receiving request: ", e);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });
  
  // Example endpoint to test Firestore connection
  app.get("/test-connection", async (req, res) => {
    try {
      const snapshot = await db.collection("patients").limit(1).get();
      if (snapshot.empty) {
        res.json({ message: "Connection successful but no documents found" });
      } else {
        res.json({
          message: "Connection successful",
          documentCount: snapshot.size,
        });
      }
    } catch (error) {
      console.error("Firebase connection error:", error);
      res.status(500).json({ error: "Failed to connect to Firebase" });
    }
  });
  
  app.listen(PORT, () => {
    console.log(`Express app listening at http://localhost:${PORT}`);
  });
