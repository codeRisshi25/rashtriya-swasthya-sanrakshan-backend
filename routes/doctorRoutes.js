const express = require("express");
const multer = require("multer");
const { addRecord, getPatients } = require("../controllers/doctorController");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'temp/'); // Make sure this directory exists
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Route to get patients a doctor has access to
router.get('/access/patients/:uid', getPatients);

// Route to add a medical record (with file upload)
router.post('/addrecord/:uid', upload.single('recordFile'), addRecord);

module.exports = router;
