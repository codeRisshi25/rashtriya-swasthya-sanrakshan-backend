const crypto = require('crypto')
const firebaseConfig = require("../config/firebaseConfig.js");

// function to get available doctors with their details
const retrieveDoctors = async (userID) => {
    try {
        let { db } = firebaseConfig;
        // Get patient document using userID
        const userDoc = await db.collection('patients').doc(userID).get();
        
        if (!userDoc.exists) {
            console.log('No patient found with this ID');
            return [];
        }
        
        const userData = userDoc.data();
        let doctorIDs = [];
        
        // Check if doctors field exists and get as array
        if (userData.doctors && Array.isArray(userData.doctors)) {
            doctorIDs = userData.doctors;
            console.log(doctorIDs);
        } else if (userData.doctors) {
            // If doctors exists but not as array, convert to array
            doctorIDs = [userData.doctors];
        } else {
            // If no doctors field exists
            console.log('No doctors assigned to this patient');
            return [];
        }

        // Retrieve doctor details from doctors collection
        const doctorsDetails = [];
        for (const doctorID of doctorIDs) {
            console.log("Looking for doctor with ID:", doctorID);
            const doctorQuerySnapshot = await db.collection('doctors')
                .where('userId', '==', doctorID)
                .limit(1)
                .get();
            
            if (!doctorQuerySnapshot.empty) {
                const doctorData = doctorQuerySnapshot.docs[0].data();
                doctorsDetails.push({
                    id: doctorID,
                    name: doctorData.name || '',
                    specialty: doctorData.department || '',
                    hospital: doctorData.hospital_affiliation || '',
                });
            } else {
                console.log(`No doctor found with ID: ${doctorID}`);
            }
        }
        console.log("In total doctor details :-",doctorsDetails);
        
        return doctorsDetails;
    } catch (error) {
        console.log("Error while retrieving available doctors", error);
        return [];
    }
}

module.exports = {
    retrieveDoctors
}