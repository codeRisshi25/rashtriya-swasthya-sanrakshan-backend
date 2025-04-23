const { db } = require("../config/firebaseConfig");

// Controller to get all doctors
const getAllDoctors = async (req, res) => {
  try {
    const snap = await db.collection("doctors").get();
    const doctors = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    res.json(doctors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAllDoctors
};