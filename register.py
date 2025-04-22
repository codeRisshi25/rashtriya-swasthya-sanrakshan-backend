from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
import logging
import hashlib
import os
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv


# Load environment variables from .env file
load_dotenv()

# Initialize logging
logging.basicConfig(level=logging.DEBUG)

# Initialize Firebase Admin SDK
try:
    cred = credentials.Certificate('./project-charak-firebase-adminsdk-fbsvc-d9521be673.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase initialized successfully")
except Exception as e:
    print(f"Error initializing Firebase: {str(e)}")
    raise

# Create global storage for user data during registration flow
user_data_store = {}

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', os.urandom(24))
CORS(app, supports_credentials=True, origins="*")  # Enable CORS for all routes

# API Key and Secret from environment variables
API_KEY = os.getenv('API_KEY')
API_SECRET = os.getenv('API_SECRET')

# Access token from environment variables
access_token = os.getenv('ACCESS_TOKEN')

# Route to send OTP
@app.route('/send-otp', methods=['POST'])
def send_otp():
    # Get data from request
    data = request.json
    aadhar_number = data.get('aadhaarId')
    password = data.get('password')

    if not aadhar_number or len(aadhar_number) != 12 or not aadhar_number.isdigit():
        return jsonify({'success': False, 'message': 'Invalid Aadhar number'}), 400

    # Store in global dictionary instead of session
    user_data_store[aadhar_number] = {
        'password': password,
        'timestamp': import_time()  # Add timestamp for cleanup later
    }

    url = 'https://api.sandbox.co.in/kyc/aadhaar/okyc/otp'
    headers = {
        'Authorization': access_token,
        'x-api-key': API_KEY,
        'x-api-version': '2.0',
        'Content-type': 'application/json'
    }
    payload = json.dumps({
        '@entity': 'in.co.sandbox.kyc.aadhaar.okyc.otp.request',
        'aadhaar_number': aadhar_number,
        'consent': 'y',
        'reason': 'For KYC'
    })

    try:
        response = requests.request("POST", url, headers=headers, data=payload)
        response_data = response.json()
        print('Aadhar API Response:', response_data)  # Log the response for debugging

        # Extract reference_id from the nested 'data' key
        reference_id = response_data.get('data', {}).get('reference_id')

        if response.status_code == 200 and reference_id:
            print('OTP sent successfully:', reference_id)
            # Store reference_id in user data store
            user_data_store[aadhar_number]['reference_id'] = reference_id
            return jsonify({
                'success': True, 
                'reference_id': reference_id,
                'aadhaarId': aadhar_number  # Return aadhar ID for client to use in subsequent requests
            })
        else:
            return jsonify({'success': False, 'message': response_data.get('message', 'Failed to send OTP')}), response.status_code
    except Exception as e:
        print('Error in /send-otp:', str(e))
        return jsonify({'success': False, 'message': 'Internal server error'}), 500
    

@app.route('/verify-otp', methods=['POST'])
def verify_otp():
    data = request.json
    otp = data.get('otp')
    reference_id = data.get('reference_id')
    aadhar_number = data.get('aadhaarId')  # Get aadhar number from request
    
    # If aadhar_number is not provided in the request, try to find it by reference_id
    if not aadhar_number:
        for aadhaar, info in user_data_store.items():
            if info.get('reference_id') == reference_id:
                aadhar_number = aadhaar
                break
    
    # Check if we have the required data in the store
    if not aadhar_number or aadhar_number not in user_data_store:
        return jsonify({'success': False, 'message': 'Session expired, please restart the verification process'}), 400

    print('Incoming Request Body:', otp, reference_id, aadhar_number)

    # Input validation
    if not otp or len(otp) != 6 or not otp.isdigit():
        return jsonify({'success': False, 'message': 'Invalid OTP'}), 400
    if not reference_id:
        return jsonify({'success': False, 'message': 'Missing reference ID'}), 400

    url = 'https://api.sandbox.co.in/kyc/aadhaar/okyc/otp/verify'
    headers = {
        'Authorization': access_token,
        'x-api-key': API_KEY,
        'x-api-version': '2.0',
        'Content-Type': 'application/json'
    }
    
    # Modified payload structure to match API requirements
    payload = {
        "@entity": "in.co.sandbox.kyc.aadhaar.okyc.request",
        "reference_id": str(reference_id),
        "otp": str(otp)
    }

    try:
        response = requests.post(url, headers=headers, json=payload)
        response_data = response.json()
        print('Aadhar API Response:', response_data)
        
        # Store response in global dict instead of session
        if response.status_code == 200:
            user_data_store[aadhar_number]['otp_verification_data'] = response_data
            
            # Extract user data from response for frontend
            user_data = response_data.get('data', {})
            
            # Format response to match frontend expectations
            formatted_response = {
                'success': True, 
                'message': 'OTP verified successfully',
                'name': user_data.get('name', ''),
                'gender': user_data.get('gender', ''),
                'dob': user_data.get('date_of_birth', ''),
                'address': user_data.get('full_address', ''),
                'photo': user_data.get('photo', '')
            }
            
            return jsonify(formatted_response)
        else:
            return jsonify({
                'success': False, 
                'message': response_data.get('message', 'Failed to verify OTP'),
                'data': response_data
            }), response.status_code

    except Exception as e:
        print('Error in /verify-otp:', str(e))
        return jsonify({'success': False, 'message': 'Internal server error'}), 500
    

@app.route('/register-user', methods=['POST'])  # Add hyphenated route to match frontend
@app.route('/register_user', methods=['POST'])  # Keep underscore route for backward compatibility
def register_user():
    data = request.get_json()
    print('Incoming Medical Data:', data)
    
    # Find the most recent verification in user_data_store
    latest_timestamp = 0
    latest_aadhar = None
    
    for aadhaar, info in user_data_store.items():
        if ('otp_verification_data' in info and 
            info.get('timestamp', 0) > latest_timestamp and
            aadhaar != 'active_users'):  # Skip the active_users entry
            latest_timestamp = info.get('timestamp', 0)
            latest_aadhar = aadhaar
    
    aadhar_number = latest_aadhar
    
    # Check if we found any verification data
    if not aadhar_number or aadhar_number not in user_data_store:
        return jsonify({
            'success': False,
            'message': 'No verification data found. Please complete verification first.'
        }), 400
    
    user_info = user_data_store[aadhar_number]
    
    if 'otp_verification_data' not in user_info:
        return jsonify({
            'success': False,
            'message': 'Missing OTP verification data. Please complete verification first.'
        }), 400
    
    # Get previously stored verification data
    verification_data = user_info.get('otp_verification_data', {})
    password = user_info.get('password', '')
    
    print(f'Found verification data for Aadhaar: {aadhar_number}')
    
    # Generate unique ID
    user_id = hashlib.sha256(f"{aadhar_number}{password}".encode()).hexdigest()[:10]
    
    # Extract user data from verification response
    api_user_data = verification_data.get('data', {})
    
    # Extract medical information from request
    height = data.get('height', '')
    weight = data.get('weight', '')
    blood_type = data.get('bloodType', '')
    allergies_details = data.get('allergiesDetails', '')
    conditions = data.get('conditions', [])
    vaccines = data.get('vaccines', [])
    medications = data.get('medications', '')
    emergency_contact = data.get('emergencyContact', '')
    age = data.get('age', '')
    
    # Process allergies - convert from string to array if needed
    allergies = []
    if isinstance(allergies_details, str) and allergies_details.strip():
        allergies = [a.strip() for a in allergies_details.split(',')]
    elif isinstance(allergies_details, list):
        allergies = allergies_details
    contact = {}
    if isinstance(emergency_contact, str) and emergency_contact.strip():
        details = [a.strip() for a in emergency_contact.split(',')]
        if len(details) == 2:
            contact = {'name': details[0], 'phone': details[1]}
    
    # Build user data structure combining verification data with medical data
    user_data = {
        'id': user_id,
        'aadharId': aadhar_number,
        'password': hashlib.sha256(password.encode()).hexdigest(),
        'name': api_user_data.get('name', ''),
        'gender': api_user_data.get('gender', ''),
        'dob': api_user_data.get('dateofBirth', api_user_data.get('date_of_birth', '')),
        'address': api_user_data.get('fullAddress', api_user_data.get('full_address', '')),
        'photoUrl': api_user_data.get('photoUrl', api_user_data.get('photo', '')),
        'role': 'patient',
        'height': height,
        'weight': weight,
        'contact': emergency_contact,
        'age': age,
        'currentMedications': medications,
        'medicalDetails': {
            'bloodGroup': blood_type,
            'allergies': allergies,
            'emergencyContact': emergency_contact
        },
        'medicalHistory': conditions,
        'vaccinationHistory': vaccines,
        'created_at': firestore.SERVER_TIMESTAMP
    }
    
    # Try to handle different API response formats with fallbacks
    for key, value in user_data.items():
        if value == '':
            # Check alternative field names in the API response
            alt_field_names = {
                'dob': ['date_of_birth', 'birthdate', 'birth_date'],
                'address': ['full_address', 'address', 'permanentAddress'],
                'photoUrl': ['photo', 'image', 'profile_image']
            }
            
            if key in alt_field_names:
                for alt_name in alt_field_names[key]:
                    if api_user_data.get(alt_name):
                        user_data[key] = api_user_data.get(alt_name)
                        break

    try:
        print(f"Saving user with ID: {user_id}")
        
        # Check if user already exists
        doc_ref = db.collection('patients').document(user_id)
        doc = doc_ref.get()
        
        if doc.exists:
            return jsonify({
                'success': False,
                'message': 'User already exists'
            }), 400
        
        # Save to Firestore
        doc_ref.set(user_data)
        
        # Clean up after successful registration
        if aadhar_number in user_data_store:
            del user_data_store[aadhar_number]
        
        print(f"User registered successfully: {user_id}")
        
        return jsonify({
            'success': True, 
            'message': 'User registered successfully',
            'user': {
                'id': user_id,
                'name': user_data['name'],
                'role': 'patient'
            }
        }), 201
    
    except Exception as e:
        print('Error saving user to Firestore:', str(e))
        return jsonify({
            'success': False, 
            'message': f'Failed to register user: {str(e)}'
        }), 500

# Helper function to get current time
def import_time():
    import time
    return time.time()


if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=4505, debug=True)
    except Exception as e:
        print('Failed to start the server:', str(e))