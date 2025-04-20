const express = require('express');
const cors = require('cors');
require('dotenv').config()
const crypto = require('crypto');

// server and middleware
const app = express();
const PORT = process.env.PORT || 4505;
app.use(cors());
app.use(express.json()); // Add JSON body parser middleware

// Firebase setup
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue, Filter } = require('firebase-admin/firestore');
const serviceAccount = require('../project-charak-firebase-adminsdk-fbsvc-d9521be673.json');

// Initialize firebase
initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

// Function to get user data
const getUserData = async (userID, role, password) => {
    try {
        // Validate inputs
        if (!userID || !role || !password) {
            throw new Error('Missing required parameters: userID, role, or password');
        }
        
        // Log the input parameters for debugging
        console.log(`Attempting login: userID=${userID}, role=${role}`);
        
        // Hash userID and password to generate user_id
        const hash = crypto.createHash('sha256');
        hash.update(userID + password, 'utf8');
        const user_id = hash.digest('hex').substring(0, 10);
        console.log(`Generated user_id: ${user_id}`);
        
        // Fetch user document from Firestore
        const doc = await db.collection(role).doc(user_id).get();
        if (!doc.exists) {
            console.log(`No document found for userID: ${user_id} in role: ${role}`);
            
            // Try to find by aadharId (alternative lookup)
            console.log(`Trying alternative lookup by aadharId: ${userID}`);
            const querySnapshot = await db.collection(role)
                .where('aadharId', '==', userID)
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
            const storedPassword = userData.password || '';
            const hashedInputPassword = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
            
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
        const storedPassword = userData.password || '';
        const hashedInputPassword = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
        
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

app.post('/auth/login', (req, res) => {
    try {
        const data = req.body; // Changed from req.data to req.body
        console.log('[ Login data from Client ] : ', data);
        
        if (!data) {
            return res.status(400).json({
                'success': false,
                'message': "Invalid request"
            });
        }

        // Getting the required data from the request
        const userID = data.userID; // Changed from data.get('userID')
        const role = data.role;     // Fixed from data.get('password')
        const password = data.password;

        const valid_roles = ['patients', 'doctors', 'government'];
        if (!valid_roles.includes(role)) { // Fixed array membership check
            return res.status(400).json({
                success: false,
                message: "Invalid role"
            });
        }
        
        getUserData(userID, role, password).then(userData => {
            if (userData) {
                res.status(200).json({
                    success: true,
                    message: "Login successful",
                    data: userData
                });
            } else {
                res.status(401).json({
                    success: false,
                    message: "Invalid credentials"
                });
            }
        }).catch(error => {
            console.error("Error while fetching user data: ", error);
            res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        });
    } catch (e) {
        console.log("Error while receiving request: ", e);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

// Example endpoint to test Firestore connection
app.get('/test-connection', async (req, res) => {
    try {
        const snapshot = await db.collection('patients').limit(1).get();
        if (snapshot.empty) {
            res.json({ message: "Connection successful but no documents found" });
        } else {
            res.json({ 
                message: "Connection successful", 
                documentCount: snapshot.size 
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