const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt= require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { getIo, getConnectedUsers } = require('../socketManager');
const nodemailer = require('nodemailer');
const QRCode = require("qrcode");
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Middleware to authenticate and extract user from JWT
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log("Authorization Header:", authHeader);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("Authorization header missing or invalid");
    return res.status(401).json({ message: 'Authorization token is missing' });
  }

  const token = authHeader.split(' ')[1];
  console.log("Extracted Token:", token);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("Decoded Token Payload:", decoded);
    req.user = decoded;
    next();
  } catch (error) {
    console.log("JWT Verification Error:", error.message);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};
// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Save files in the 'uploads' directory
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname); // Prevent duplicate names
  },
});

// File filter to allow only specific types
const fileFilter = (req, file, cb) => {
  cb(null, true); // Accept all files
};


// Initialize multer
const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 10MB file size limit
});

const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


JWT_SECRET='12345'
router.post('/register', async (req, res) => {
  const { email, password, role } = req.body;

  try {
    // Check if the user already exists
    const userExists = await pool.query('SELECT * FROM "User" WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into the database
    const result = await pool.query(
      'INSERT INTO "User" (email, password, role) VALUES ($1, $2, $3) RETURNING user_id',
      [email, hashedPassword, role]
    );

    res.status(201).json({ message: 'User created successfully', userId: result.rows[0].user_id });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ message: 'Registration failed', error: err.message });
  }
});


router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check if the user exists
    const result = await pool.query('SELECT * FROM "User" WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Compare the password with the stored hashed password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.user_id, role: user.role },
      JWT_SECRET,
      { expiresIn: '72h' }
    );

    res.status(200).json({ message: 'Login successful', token, role: user.role , user_id: user.user_id});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});


//QR Code generatort method 
router.get("/machines/:machine_id/qrcode", async (req, res) => {
  let { machine_id } = req.params;

  // Ensure machine_id is an integer
  machine_id = parseInt(machine_id, 10);
  if (isNaN(machine_id)) {
    return res.status(400).json({ message: "Invalid machine_id" });
  }

  try {
    // Check if machine exists
    const result = await pool.query(
      `SELECT * FROM "Machines" WHERE machine_id = $1`,
      [machine_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Machine not found" });
    }

    // Frontend URL for details page
    const machineUrl = `https://machinery-system.azurewebsites.net/machine/${machine_id}`;

    // Generate QR code as base64
    const qrCode = await QRCode.toDataURL(machineUrl);

    res.json({ qrCode });
  } catch (error) {
    console.error("Error generating QR code:", error);
    res.status(500).json({ message: "Error generating QR code" });
  }
});


// Upload endpoint
router.post(
  "/machines",
  authenticate,
  upload.fields([
    { name: "machineimagefile", maxCount: 1 },
    { name: "files_3d", maxCount: 1 },
    { name: "files_2d", maxCount: 1 },
    { name: "spare_parts_list", maxCount: 1 },
    { name: "electrical_diagram", maxCount: 1 },
    { name: "cpk_data", maxCount: 1 },
    { name: "validation_document", maxCount: 1 },
    { name: "parameter_studies", maxCount: 1 },
    { name: "plc_program", maxCount: 1 },
    { name: "hmi_program", maxCount: 1 },
    { name: "other_programs", maxCount: 1 },
    { name: "machine_manual", maxCount: 1 },
    { name: "operation_instruction", maxCount: 1 }, // ✅ NEW FIELD
  ]),
  async (req, res) => {
    try {
      console.log("Request Body:", req.body);
      console.log("Uploaded Files:", req.files);

      const {
        machine_ref,
        machine_name,
        brand,
        model,
        product_line,
        production_line,
        station,
        consumables,
        fixture_numbers,
        gage_numbers,
        tooling_numbers,
        production_rate,
        air_needed,
        air_pressure,
        air_pressure_unit,
        voltage,
        phases,
        amperage,
        frequency,
        water_cooling,
        water_temp,
        water_temp_unit,
        dust_extraction,
        fume_extraction,
        powerunits,
        year,
        user_id,
      } = req.body;

      const getFile = (field) =>
        req.files && req.files[field] ? req.files[field][0].filename : null;

      const machineimagefile = getFile("machineimagefile");
      const files_3d = getFile("files_3d");
      const files_2d = getFile("files_2d");
      const spare_parts_list = getFile("spare_parts_list");
      const electrical_diagram = getFile("electrical_diagram");
      const cpk_data = getFile("cpk_data");
      const validation_document = getFile("validation_document");
      const parameter_studies = getFile("parameter_studies");
      const plc_program = getFile("plc_program");
      const hmi_program = getFile("hmi_program");
      const other_programs = getFile("other_programs");
      const machine_manual = getFile("machine_manual");
      const operation_instruction = getFile("operation_instruction"); // ✅ NEW FILE

      await pool.query("BEGIN");
      console.log("User ID:", user_id);

      // ✅ Insert into Machines
      const machineResult = await pool.query(
        `INSERT INTO "Machines" 
          (machine_ref,machine_name, brand, model, product_line, production_line, station,
          machineimagefile, files_3d, files_2d, spare_parts_list, electrical_diagram, plc_program, hmi_program, 
          other_programs, machine_manual, operation_instruction, consumables, fixture_numbers, gage_numbers, tooling_numbers, 
          cpk_data, production_rate, validation_document, parameter_studies, air_needed, air_pressure, air_pressure_unit, 
          voltage, phases, amperage, frequency, water_cooling, water_temp, water_temp_unit, dust_extraction, fume_extraction, powerunits,year) 
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 
           $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39) 
        RETURNING machine_id`,
        [
          machine_ref,
          machine_name,
          brand,
          model,
          product_line,
          production_line,
          station,
          machineimagefile,
          files_3d,
          files_2d,
          spare_parts_list,
          electrical_diagram,
          plc_program,
          hmi_program,
          other_programs,
          machine_manual,
          operation_instruction, // ✅ NEW
          consumables,
          fixture_numbers,
          gage_numbers,
          tooling_numbers,
          cpk_data,
          production_rate,
          validation_document,
          parameter_studies,
          air_needed,
          air_pressure,
          air_pressure_unit,
          voltage,
          phases,
          amperage,
          frequency,
          water_cooling,
          water_temp,
          water_temp_unit,
          dust_extraction,
          fume_extraction,
          powerunits,
          year
        ]
      );

      const machine_id = machineResult.rows[0].machine_id;
      const parsedUserId = parseInt(user_id, 10);

      // ✅ Insert into Machines_Hist
      await pool.query(
        `INSERT INTO "Machines_Hist" 
          (machine_id, machine_ref, machine_name, brand, model, product_line, production_line, station,
          machineimagefile, files_3d, files_2d, spare_parts_list, electrical_diagram, plc_program, hmi_program, 
          other_programs, machine_manual, operation_instruction, consumables, fixture_numbers, gage_numbers, tooling_numbers, 
          cpk_data, production_rate, validation_document, parameter_studies, action_type, action_date, 
          user_id, air_needed, air_pressure, air_pressure_unit, voltage, phases, amperage, frequency, 
          water_cooling, water_temp, water_temp_unit, dust_extraction, fume_extraction, powerunits, year) 
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
           $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43)`,
        [
          machine_id,
          machine_ref,
          machine_name,
          brand,
          model,
          product_line,
          production_line,
          station,
          machineimagefile,
          files_3d,
          files_2d,
          spare_parts_list,
          electrical_diagram,
          plc_program,
          hmi_program,
          other_programs,
          machine_manual,
          operation_instruction, // ✅ NEW
          consumables,
          fixture_numbers,
          gage_numbers,
          tooling_numbers,
          cpk_data,
          production_rate,
          validation_document,
          parameter_studies,
          "CREATE",
          new Date(),
          parsedUserId,
          air_needed,
          air_pressure,
          air_pressure_unit,
          voltage,
          phases,
          amperage,
          frequency,
          water_cooling,
          water_temp,
          water_temp_unit,
          dust_extraction,
          fume_extraction,
          powerunits,
          year
        ]
      );

      await pool.query("COMMIT");

      res.status(201).json({
        message: "Machine created successfully",
        machine_id,
      });
    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("Error creating machine:", error);
      res.status(500).json({ message: "Error creating machine" });
    }
  }
);


router.post("/stations", async (req, res) => {
  const { station, description, machine_id, user_id } = req.body;
  console.log("Received Station:", { station, description, machine_id }); 

  try {
    // Insert into Stations and get the inserted station_id
    const insertStationResult = await pool.query(
      `INSERT INTO "Stations" (station, description, machine_id)
       VALUES ($1, $2, $3)
       RETURNING id`, // assuming "id" is the primary key column
      [station, description, machine_id]
    );

    const station_id = insertStationResult.rows[0].id;

    // Insert into Station_Hist using the returned station_id
    await pool.query(
      `INSERT INTO "Station_Hist" 
       (station_id, machine_id, station_description, station_name, action_type, action_date, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [station_id, machine_id, description, station, 'CREATE', new Date(), user_id]
    );

    res.status(201).json({ message: "Station added successfully" });
  } catch (error) {
    console.error("Error inserting station:", error);
    res.status(500).json({ message: "Failed to insert station" });
  }
});


router.put("/stations/:id", async (req, res) => {
  const { id } = req.params; // This is the stationId sent from the frontend
  const { station, description, machine_id, user_id } = req.body;

  // Log received values for debugging
  console.log("Received data:", { id, station, description, machine_id });

  // Check if any required fields are missing or undefined
  if (!station || !description || !machine_id) {
    return res.status(400).json({ message: "Missing required fields: station, description, or machine_id" });
  }

  // Ensure that id and machine_id are numbers and valid
  const numericId = parseInt(id, 10); // Ensure id is a valid number
  const numericMachineId = parseInt(machine_id, 10); // Ensure machine_id is a valid number

  // If either id or machine_id is NaN, return an error
  if (isNaN(numericId) || isNaN(numericMachineId)) {
    return res.status(400).json({ message: "Invalid ID or Machine ID" });
  }

  console.log("Updating Station:", { id: numericId, station, description, machine_id: numericMachineId });

  try {
    // Execute the SQL update query
    const result = await pool.query(
      `UPDATE "Stations"
       SET station = $1,
           description = $2,
           machine_id = $3
       WHERE id = $4`,
      [station, description, numericMachineId, numericId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Station not found" });
    }

    await pool.query(
      `INSERT INTO "Station_Hist" 
       (station_id, machine_id, station_description, station_name, action_type, action_date, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [numericId, numericMachineId, description, station, 'UPDATE', new Date(), user_id]
    );
    



    res.status(200).json({ message: "Station updated successfully" });
  } catch (error) {
    console.error("Error updating station:", error);
    res.status(500).json({ message: "Failed to update station" });
  }
});

router.delete("/stations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const delResult = await pool.query(`DELETE FROM "Stations" WHERE id = $1`, [id]);
    if (delResult.rowCount === 0) return res.status(404).json({ message: "Station not found" });
    res.json({ message: "Station deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete station" });
  }
});



// Route to get stations by machine_id
router.get('/stations/:machine_id', async (req, res) => {
  const { machine_id } = req.params; // Extract machine_id from the URL parameter

  try {
    // Query to get stations related to the given machine_id
    const result = await pool.query(
      `SELECT * FROM "Stations" WHERE "machine_id" = $1`,
      [machine_id]
    );

    // If no stations are found for the given machine_id, return a 404 error
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No stations found for this machine.' });
    }

    // Return the stations in the response
    res.status(200).json(result.rows); // result.rows contains the fetched stations

  } catch (error) {
    console.error("Error fetching stations by machine_id:", error);
    res.status(500).json({ message: "Failed to fetch stations" });
  }
});

router.get("/machineproducts/:machine_id", async (req, res) => {
  const { machine_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT product_id FROM "MachineProducts" WHERE machine_id = $1`,
      [machine_id]
    );
    res.json(result.rows.map(row => row.product_id));
  } catch (error) {
    console.error("Error fetching machine products:", error);
    res.status(500).json({ message: "Failed to fetch machine products" });
  }
});

router.post("/machineproducts", async (req, res) => {
  const { machine_id, product_id, user_id } = req.body;

  console.log('Received request to link:', { machine_id, product_id }); // 🚨 Debug

  // Check if product_id is valid
  if (!product_id || product_id.trim() === "") {
    return res.status(400).json({ message: "Invalid product ID" });
  }

  try {
    // Insert into MachineProducts
    await pool.query(
      `INSERT INTO "MachineProducts" (machine_id, product_id) VALUES ($1, $2)`,
      [machine_id, product_id]
    );

    // Insert into MachineProducts_Hist
    await pool.query(
      `INSERT INTO "MachineProducts_Hist" 
       (machine_id, product_id, action_type, action_date, user_id)
       VALUES ($1, $2, $3, NOW(), $4)`,
      [machine_id, product_id, 'CREATE', user_id]
    );

    res.status(201).json({ message: "Machine product added and logged successfully" });
  } catch (error) {
    console.error("Error inserting machineproduct:", error);
    res.status(500).json({ message: "Failed to insert machineproduct" });
  }
});


router.delete("/machineproducts", async (req, res) => {
  const { machine_id, product_id, user_id } = req.body;

  try {
    await pool.query(
      `DELETE FROM "MachineProducts" WHERE machine_id = $1 AND product_id = $2`,
      [machine_id, product_id]
    );


    res.status(200).json({ message: "Deleted machine product successfully" });
  } catch (error) {
    console.error("Error deleting machineproduct:", error);
    res.status(500).json({ message: "Failed to delete machineproduct" });
  }
});


router.put(
  "/machines/:id",
  upload.fields([
    { name: "machineimagefile", maxCount: 1 },
    { name: "files_3d", maxCount: 1 },
    { name: "files_2d", maxCount: 1 },
    { name: "spare_parts_list", maxCount: 1 },
    { name: "electrical_diagram", maxCount: 1 },
    { name: "cpk_data", maxCount: 1 },
    { name: "validation_document", maxCount: 1 },
    { name: "parameter_studies", maxCount: 1 },
    { name: "plc_program", maxCount: 1 },
    { name: "hmi_program", maxCount: 1 },
    { name: "other_programs", maxCount: 1 },
    { name: "machine_manual", maxCount: 1 },
    { name: "operation_instruction", maxCount: 1 },
  ]),
  async (req, res) => {
    const { id } = req.params;

    const cleanedBody = Object.fromEntries(
      Object.entries(req.body).map(([key, value]) => [
        key,
        value === "null" ? null : value,
      ])
    );

    const {
      machine_ref,
      machine_name,
      brand,
      model,
      product_line,
      production_line,
      station,
      consumables,
      fixture_numbers,
      gage_numbers,
      tooling_numbers,
      production_rate,
      air_needed,
      air_pressure,
      air_pressure_unit,
      voltage,
      phases,
      amperage,
      frequency,
      water_cooling,
      water_temp,
      water_temp_unit,
      dust_extraction,
      fume_extraction,
      powerunits, // ✅ Added
      year, // ✅ Added
      user_id,
    } = cleanedBody;

    console.log("Cleaned Body:", cleanedBody);
    console.log("Files received:", req.files);

    // Helper for files
    const getFileValue = (field) => {
      const action = req.body[`${field}_action`];
      if (req.files && req.files[field]) {
        return req.files[field][0].filename;
      } else if (action === "delete") {
        return null;
      } else if (action === "keep") {
        return undefined;
      } else {
        return null;
      }
    };

    const fileFields = [
      "machineimagefile",
      "files_3d",
      "files_2d",
      "spare_parts_list",
      "electrical_diagram",
      "cpk_data",
      "validation_document",
      "parameter_studies",
      "plc_program",
      "hmi_program",
      "other_programs",
      "machine_manual",
      "operation_instruction",
    ];

    const fileUpdates = {};
    fileFields.forEach((field) => {
      const value = getFileValue(field);
      if (value !== undefined) {
        fileUpdates[field] = value;
      }
    });

    try {
      await pool.query("BEGIN");

      const fileSetClauses = Object.keys(fileUpdates).map(
        (field, idx) => `${field} = $${26 + idx + 1}`
      );

      const updateQuery = `
        UPDATE "Machines" SET
          machine_ref = $1, machine_name = $2, brand = $3, model = $4, 
          product_line = $5, production_line = $6, station = $7,
          consumables = $8, fixture_numbers = $9, 
          gage_numbers = $10, tooling_numbers = $11, 
          production_rate = $12,
          air_needed = $13, air_pressure = $14, air_pressure_unit = $15, 
          voltage = $16, phases = $17, amperage = $18, frequency = $19, 
          water_cooling = $20, water_temp = $21, water_temp_unit = $22, 
          dust_extraction = $23, fume_extraction = $24,
          powerunits = $25, year = $26
          ${fileSetClauses.length > 0 ? "," + fileSetClauses.join(", ") : ""}
        WHERE machine_id = $${27 + Object.keys(fileUpdates).length}
        RETURNING *
      `;

      const queryParams = [
        machine_ref,
        machine_name,
        brand,
        model,
        product_line,
        production_line,
        station,
        consumables,
        fixture_numbers,
        gage_numbers,
        tooling_numbers,
        production_rate,
        air_needed,
        air_pressure,
        air_pressure_unit,
        voltage,
        phases,
        amperage,
        frequency,
        water_cooling,
        water_temp,
        water_temp_unit,
        dust_extraction,
        fume_extraction,
        powerunits,
        year,
        ...Object.values(fileUpdates),
        id,
      ];

      const updatedResult = await pool.query(updateQuery, queryParams);
      const updatedMachine = updatedResult.rows[0];
      const machine_id = updatedMachine.machine_id;
      const parsedUserId = user_id ? parseInt(user_id, 10) : null;

      // ✅ Insert into history table (add powerunits & year)
      await pool.query(
        `INSERT INTO "Machines_Hist" 
          (machine_id, machine_ref, machine_name, brand, model, product_line, production_line, station,
           machineimagefile, files_3d, files_2d, spare_parts_list, electrical_diagram, plc_program, 
           hmi_program, other_programs, machine_manual, operation_instruction, consumables, fixture_numbers, 
           gage_numbers, tooling_numbers, cpk_data, production_rate, validation_document, parameter_studies, 
           powerunits, year, action_type, action_date, user_id, air_needed, air_pressure, air_pressure_unit, 
           voltage, phases, amperage, frequency, water_cooling, water_temp, water_temp_unit, dust_extraction, fume_extraction)
         VALUES 
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 
            $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43)`,
        [
          machine_id,
          machine_ref,
          machine_name,
          brand,
          model,
          product_line,
          production_line,
          station,
          updatedMachine.machineimagefile,
          updatedMachine.files_3d,
          updatedMachine.files_2d,
          updatedMachine.spare_parts_list,
          updatedMachine.electrical_diagram,
          updatedMachine.plc_program,
          updatedMachine.hmi_program,
          updatedMachine.other_programs,
          updatedMachine.machine_manual,
          updatedMachine.operation_instruction,
          consumables,
          fixture_numbers,
          gage_numbers,
          tooling_numbers,
          updatedMachine.cpk_data,
          production_rate,
          updatedMachine.validation_document,
          updatedMachine.parameter_studies,
          powerunits,
          year,
          "UPDATE",
          new Date(),
          parsedUserId,
          air_needed,
          air_pressure,
          air_pressure_unit,
          voltage,
          phases,
          amperage,
          frequency,
          water_cooling,
          water_temp,
          water_temp_unit,
          dust_extraction,
          fume_extraction,
        ]
      );

      await pool.query("COMMIT");
      res.status(200).json(updatedMachine);
    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("Error updating machine:", error);
      res.status(500).json({ message: "Error updating machine", error: error.message });
    }
  }
);



router.delete('/machines/:machine_id', async (req, res) => {
  const { machine_id } = req.params;
  const { user_id } = req.body; // Get the user_id from the request body

  try {
    // Step 1: Retrieve the machine details before deletion
    const machineResult = await pool.query('SELECT * FROM "Machines" WHERE machine_id = $1', [machine_id]);

    // If the machine does not exist, return an error
    if (machineResult.rows.length === 0) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    const machine = machineResult.rows[0]; // Extract the machine data
    console.log('machinehist',machine);

    // Step 2: Delete the machine from the "Machines" table
    await pool.query('DELETE FROM "Machines" WHERE machine_id = $1', [machine_id]);

    // Step 3: Insert the deleted machine's data into the "Machines_Hist" table with action_type "DELETE"
    await pool.query(
     `INSERT INTO "Machines_Hist" 
          (machine_id, machine_ref, machine_name, brand, model, product_line, production_line, station,
          machineimagefile, files_3d, files_2d, spare_parts_list, electrical_diagram, plc_program, hmi_program, 
          other_programs, machine_manual, consumables, fixture_numbers, gage_numbers, tooling_numbers, 
          cpk_data, production_rate, validation_document, parameter_studies, action_type, action_date, 
          user_id, air_needed, air_pressure, air_pressure_unit, voltage, phases, amperage, frequency, 
          water_cooling, water_temp, water_temp_unit, dust_extraction, fume_extraction) 
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
           $21, $22, $23, $24, $25, $26, NOW(), $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39)`,
      [
        machine.machine_id,
        machine.machine_ref,
        machine.machine_name,
        machine.brand,
        machine.model,
        machine.product_line,
        machine.production_line,
        machine.station,
        machine.machineimagefile,
        machine.files_3d,
        machine.files_2d,
        machine.spare_parts_list,
        machine.electrical_diagram,
        machine.plc_program,
        machine.hmi_program,
        machine.other_programs,
        machine.machine_manual,
        machine.consumables,
        machine.fixture_numbers,
        machine.gage_numbers,
        machine.tooling_numbers,
        machine.cpk_data,
        machine.production_rate,
        machine.validation_document,
        machine.parameter_studies,
        "DELETE", // Action type set to DELETE
        user_id, // The user who performed the action
        machine.air_needed,
        machine.air_pressure,
        machine.air_pressure_unit,
        machine.voltage,
        machine.phases,
        machine.amperage,
        machine.frequency,
        machine.water_cooling,
        machine.water_temp,
        machine.water_temp_unit,
        machine.dust_extraction,
        machine.fume_extraction
      ]
    );

    // Successfully deleted
    res.json({ message: 'Machine deleted successfully', machine: machineResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting machine' });
  }
});

// GET /machines/:id/products
router.get("/machines/:id/product-ids", async (req, res) => {
  const machineId = parseInt(req.params.id, 10); // Convert string to integer

  try {
    const result = await pool.query(
      `SELECT machine_id, product_id
       FROM "MachineProducts"
       WHERE machine_id = $1`,
      [machineId]
    );

    res.status(200).json({
      machine_id: machineId,
      product_ids: result.rows.map(row => row.product_id), // Just return an array of IDs
    });
  } catch (error) {
    console.error("Error fetching product IDs:", error);
    res.status(500).json({ message: "Failed to fetch product IDs." });
  }
});





router.get("/machines/:machine_id", async (req, res) => {
  const { machine_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM "Machines" WHERE machine_id = $1`,
      [machine_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Machine not found" });
    }

    const machine = result.rows[0];
    res.status(200).json(machine);
  } catch (error) {
    console.error("Error fetching machine details:", error);
    res.status(500).json({ message: "Error fetching machine details" });
  }
});







router.get('/machines', async (req, res) => {
  try {
    // Fetch all machines from the database
    const result = await pool.query(`
      SELECT * FROM "Machines"
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching machines' });
  }
});


router.get('/users', async (req, res) => {
  try {
    // Fetch all machines from the database
    const result = await pool.query(`
      SELECT * FROM "User"
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching machines' });
  }
});



router.get('/machinesproducts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "MachineProducts"');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching MachineProducts' });
  }
});

router.get('/machines/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query('SELECT * FROM machine WHERE machine_id  = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching machine details' });
  }
});


 
// File download endpoint
router.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../uploads', filename);

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('File download error:', err);
      res.status(500).json({ message: 'Error downloading file' });
    }
  });
});

router.post('/Products', async (req, res) => {
  const { product_id, product_description, user_id } = req.body;
  console.log('REQ BODY:', req.body);  // Log to check if user_id is passed correctly

  if (!user_id) {
    console.error('User ID is missing in the request.');
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    await pool.query('BEGIN');

    const productResult = await pool.query(
      'INSERT INTO "Products" (product_id,product_description) VALUES ($1, $2) RETURNING *',
      [product_id, product_description]
    );

    const newProduct = productResult.rows[0];

    await pool.query(
      'INSERT INTO "Products_Hist" (product_id, description, action_type, action_date, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [
        newProduct.product_id,
        newProduct.product_description,
        'CREATE',
        new Date(),
        user_id,
      ]
    );

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Product added successfully',
      product: newProduct,
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error adding product:', err);
    res.status(500).json({ message: 'Error adding product' });
  }
});


router.post('/Productss', async (req, res) => {
  const { product_id, product_description, user_id } = req.body;
  console.log('REQ BODY:', req.body);  // Log to check if user_id is passed correctly

  if (!user_id) {
    console.error('User ID is missing in the request.');
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    await pool.query('BEGIN');

    const productResult = await pool.query(
      'INSERT INTO "Products" (product_id,product_description) VALUES ($1, $2) RETURNING *',
      [product_id, product_description]
    );

    const newProduct = productResult.rows[0];

    await pool.query(
      'INSERT INTO "Products_Hist" (product_id, description, action_type, action_date, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [
        newProduct.product_id,
        newProduct.product_description,
        'UPDATE',
        new Date(),
        user_id,
      ]
    );

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Product added successfully',
      product: newProduct,
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error adding product:', err);
    res.status(500).json({ message: 'Error adding product' });
  }
});




router.get('/Products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "Products"');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching Products' });
  }
});


// Example GET /products/check-id/:id
router.get("/products/check-id/:id", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(`SELECT 1 FROM "Products" WHERE product_id = $1`, [id]);
  res.json({ exists: result.rows.length > 0 });
});

router.post('/facilities', async (req, res) => {
  const { 
    air_needed, air_pressure, air_pressure_unit, voltage, phases, amperage, 
    frequency, water_cooling, water_temp, water_temp_unit, dust_extraction, 
    fume_extraction, machine_id 
  } = req.body;

  try {
    // Check if the machine_id exists in the Machines table
    const machineResult = await pool.query('SELECT * FROM machine WHERE machine_id = $1', [machine_id]);

    // If the machine does not exist, return an error
    if (machineResult.rows.length === 0) {
      return res.status(400).json({ message: 'Machine ID does not exist' });
    }

  

    // Start transaction for facilities insertion
    await pool.query('BEGIN');

    // Insert the facility requirements, referencing the machine_id
    const facilityResult = await pool.query(
      'INSERT INTO "FacilitiesRequirements" (air_needed, air_pressure, air_pressure_unit, voltage, phases, amperage, frequency, water_cooling, water_temp, water_temp_unit, dust_extraction, fume_extraction, machine_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *',
      [air_needed, air_pressure, air_pressure_unit, voltage, phases, amperage, frequency, water_cooling, water_temp, water_temp_unit, dust_extraction, fume_extraction, machine_id]
    );

    // Commit transaction
    await pool.query('COMMIT');

    // Send success response with the last machine details
    res.status(201).json({ 
      message: 'Facilities requirements added successfully', 
      facility: facilityResult.rows[0] 
    });
  } catch (err) {
    // Rollback in case of an error
    await pool.query('ROLLBACK');
    console.error('Error adding facilities:', err);
    res.status(500).json({ message: 'Error adding facilities' });
  }
});



router.get('/facilities/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query('SELECT * FROM "FacilitiesRequirements" WHERE id= $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Facilities not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching machine details' });
  }
});

router.get('/facilities/machine/:machine_id', async (req, res) => {
  const { machine_id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM "FacilitiesRequirements" WHERE machine_id = $1', 
      [machine_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No facilities found for this machine' });
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching facilities' });
  }
});

router.post('/failure', async (req, res) => {
  const {
    machine_id,
    failure_desc,
    solution,
    failure_date,
    status,
    resolved_date,
    user_id,
    role
  } = req.body;

  try {
    const machineId = parseInt(machine_id, 10);

    // 1. Check if machine exists
    const machineResult = await pool.query(
      'SELECT * FROM "Machines" WHERE machine_id = $1',
      [machineId]
    );
    if (machineResult.rows.length === 0) {
      return res.status(400).json({ message: 'Machine ID does not exist' });
    }

    let creator = null;
    let executor = null;

    if (role === "MANAGER") {
      creator = user_id;
      executor = user_id; // ✅ fix null executor
    } else if (role === "EXECUTOR") {
      executor = user_id;

      const teamResult = await pool.query(
        `SELECT manager_id FROM "TeamAssignments" WHERE executor_id = $1`,
        [executor]
      );
      if (teamResult.rows.length === 0) {
        return res.status(400).json({ message: 'Executor not assigned to any manager' });
      }
      creator = teamResult.rows[0].manager_id;
    }

    // ✅ normalize status
    let finalStatus = status;
    if (!["Open", "Resolved", "Cancelled"].includes(finalStatus)) {
      finalStatus = "Open";
    }

    // ✅ resolved_date rule
    let finalResolvedDate = null;
    if (finalStatus === "Resolved") {
      finalResolvedDate = resolved_date || new Date();
    }

    const failureResult = await pool.query(
      `INSERT INTO "FailureLog"
       (machine_id, failure_desc, solution, failure_date, status, resolved_date, executor, creator)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_TIMESTAMP), $5, $6, $7, $8)
       RETURNING *`,
      [machineId, failure_desc, solution, failure_date, finalStatus, finalResolvedDate, executor, creator]
    );

    res.status(201).json({
      message: 'Failure reported successfully',
      failure: failureResult.rows[0]
    });
  } catch (err) {
    console.error('Error inserting failure log:', err.message);
    res.status(500).json({ message: 'Error inserting failure log', error: err.message });
  }
});


// Get all failures
router.get('/failures', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.failure_id, f.machine_id, m.machine_name, m.machine_ref,  f.failure_desc, f.solution, 
              f.failure_date, f.status, f.executor, f.creator, f.resolved_date
       FROM "FailureLog" f
       JOIN "Machines" m ON f.machine_id = m.machine_id
       ORDER BY f.failure_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching failures:', err);
    res.status(500).json({ message: 'Error fetching failures' });
  }
});


// Update failure
router.put('/failure/:failure_id', async (req, res) => {
  const { failure_id } = req.params;
  const {
    machine_id,        // <-- from the dropdown
    failure_desc,
    solution,
    failure_date,
    status,
    resolved_date
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE "FailureLog"
       SET machine_id = $1,
           failure_desc = $2,
           solution = $3,
           failure_date = $4,
           status = $5,
           resolved_date = $6
       WHERE failure_id = $7
       RETURNING *`,
      [machine_id, failure_desc, solution, failure_date, status, resolved_date, failure_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Failure not found' });
    }

    res.json({ message: 'Failure updated successfully', failure: result.rows[0] });
  } catch (err) {
    console.error('Error updating failure:', err);
    res.status(500).json({ message: 'Error updating failure' });
  }
});


// Delete failure
router.delete('/failure/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM "FailureLog" WHERE failure_id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Failure not found' });
    }

    res.json({ message: 'Failure deleted successfully' });
  } catch (err) {
    console.error('Error deleting failure:', err);
    res.status(500).json({ message: 'Error deleting failure' });
  }
});

router.get('/failure/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT f.*, m.machine_name, m.machine_ref
       FROM "FailureLog" f
       LEFT JOIN "Machines" m ON f.machine_id = m.machine_id
       WHERE f.failure_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Failure not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching failure details:', err);
    res.status(500).json({ message: 'Error fetching failure details' });
  }
});





//normalize the start date and end date 

function normalizeDate(dateInput) {
  const d = new Date(dateInput);
  d.setMilliseconds(0); // remove milliseconds
  return d;
}


async function generateAndSendPdf(
  maintenance_id,
  machine_id,
  maintenance_type,
  task_name,
  task_description,
  assigned_to,
  creator,
  start_date,
  end_date
) {
  try {
    // === Fetch related data ===
    const assignedUser = await pool.query('SELECT email FROM "User" WHERE user_id = $1', [assigned_to]);
    const creatorUser = await pool.query('SELECT email FROM "User" WHERE user_id = $1', [creator]);
    const machine = await pool.query('SELECT machine_name FROM "Machines" WHERE machine_id = $1', [machine_id]);
    const schedule = await pool.query('SELECT * FROM "Maintenance_schedule" WHERE maintenance_id = $1 LIMIT 1', [maintenance_id]);

    const assigned_email = assignedUser.rows[0]?.email;
    const creator_email = creatorUser.rows[0]?.email;
    const machine_name = machine.rows[0]?.machine_name || 'Unknown Machine';
    const scheduleData = schedule.rows[0];

    const recurrenceText = formatRecurrence(scheduleData);
    const until = schedule.rows[0].until;

    // === Generate PDF ===
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `Maintenance Report - ${task_name}`,
          Author: 'AVOCARBON Maintenance System',
          Subject: `Maintenance Report for ${task_name}`,
        }
      });

      const pdfChunks = [];

      doc.on('data', (chunk) => pdfChunks.push(chunk));
      doc.on('end', async () => {
        try {
          const pdfBuffer = Buffer.concat(pdfChunks);

          // Save to uploads directory
          const uploadsDir = path.join(__dirname, '..', 'uploads');
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          const pdfPath = path.join(uploadsDir, `maintenance-report-${maintenance_id}.pdf`);
          fs.writeFileSync(pdfPath, pdfBuffer);
          console.log(`PDF saved to: ${pdfPath}`);

          // Send email
          if (assigned_email) {
            await sendEmailWithPdf(
              assigned_email,
              task_name,
              maintenance_type,
              task_description,
              machine_name,
              start_date,
              end_date,
              assigned_email,
              creator_email,
              pdfBuffer,
              maintenance_id,
              recurrenceText,
              until
            );
          }

          resolve();
        } catch (error) {
          reject(error);
        }
      });

      doc.on('error', reject);

      // === PDF DESIGN ===
      const primaryColor = '#2563eb';
      const secondaryColor = '#64748b';
      const borderColor = '#e2e8f0';
      const backgroundColor = '#f8fafc';

      // Header
      doc.rect(0, 0, doc.page.width, 120).fill(primaryColor);
      doc.fillColor('white').fontSize(24).font('Helvetica-Bold').text('AVOCARBON', 50, 40);
      doc.fontSize(14).font('Helvetica').text('Maintenance System', 50, 70);
      doc.fontSize(18).font('Helvetica-Bold').text('MAINTENANCE REPORT', doc.page.width - 250, 80, { align: 'right' });

      const contentStartY = 150;

      // Task Overview
      doc.roundedRect(50, contentStartY, doc.page.width - 100, 80, 8)
         .fillColor(backgroundColor)
         .fill()
         .strokeColor(borderColor)
         .stroke();

      doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold').text('TASK OVERVIEW', 70, contentStartY + 20);
      doc.fillColor('#1e293b').fontSize(20).font('Helvetica-Bold').text(task_name, 70, contentStartY + 45);

      const columnWidth = (doc.page.width - 150) / 2;
      let currentY = contentStartY + 120;

      // Left column
      doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text('BASIC INFORMATION', 50, currentY);
      currentY += 30;
      doc.roundedRect(50, currentY, columnWidth, 180, 6).fillColor('#ffffff').fill().strokeColor(borderColor).stroke();

      const addInfoItem = (label, value, x, y, width) => {
        doc.fillColor(secondaryColor).fontSize(10).font('Helvetica').text(label, x + 20, y);
        doc.fillColor('#1e293b').fontSize(11).font('Helvetica-Bold').text(value || 'N/A', x + 20, y + 15, { width: width - 40 });
        return y + 35;
      };

      let infoY = currentY + 20;
      infoY = addInfoItem('MAINTENANCE ID', `#${maintenance_id}`, 50, infoY, columnWidth);
      infoY = addInfoItem('MAINTENANCE TYPE', maintenance_type, 50, infoY, columnWidth);
      infoY = addInfoItem('STATUS', 'In Progress', 50, infoY, columnWidth);
      infoY = addInfoItem('MACHINE', machine_name, 50, infoY, columnWidth);
      infoY = addInfoItem('CREATED BY', creator_email, 50, infoY, columnWidth);

      // Right column
      doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text('SCHEDULE & ASSIGNMENT', 50 + columnWidth + 50, currentY);
      currentY += 30;
      doc.roundedRect(50 + columnWidth + 50, currentY, columnWidth, 180, 6).fillColor('#ffffff').fill().strokeColor(borderColor).stroke();

      let rightY = currentY + 20;
      rightY = addInfoItem('START DATE', start_date.toLocaleString(), 50 + columnWidth + 50, rightY, columnWidth);
      rightY = addInfoItem('END DATE', end_date.toLocaleString(), 50 + columnWidth + 50, rightY, columnWidth);
      rightY = addInfoItem('ASSIGNED TO', assigned_email, 50 + columnWidth + 50, rightY, columnWidth);
      rightY = addInfoItem('RECURRENCE', recurrenceText, 50 + columnWidth + 50, rightY, columnWidth);
      const formattedUntil = until
     ? new Date(until).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
     : 'N/A';
      rightY = addInfoItem('UNTIL', formattedUntil, 50 + columnWidth + 50, rightY, columnWidth);
      currentY += 220;

      // Description
      doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text('TASK DESCRIPTION', 50, currentY);
      currentY += 30;
      doc.roundedRect(50, currentY, doc.page.width - 100, 120, 6).fillColor('#ffffff').fill().strokeColor(borderColor).stroke();
      doc.fillColor('#475569').fontSize(11).font('Helvetica').text(task_description, 70, currentY + 20, {
        width: doc.page.width - 140,
        align: 'left',
        lineGap: 5
      });

      currentY += 150;

      // Footer
      const footerY = doc.page.height - 50;
      doc.strokeColor(borderColor).moveTo(50, footerY - 20).lineTo(doc.page.width - 50, footerY - 20).stroke();
      doc.fillColor(secondaryColor).fontSize(9).text(`Generated on: ${new Date().toLocaleString()}`, 50, footerY - 10);
      doc.text('AVOCARBON Maintenance System - Confidential', doc.page.width - 50, footerY - 10, { align: 'right' });

      doc.end();
    });

  } catch (error) {
    console.error('Error in PDF generation:', error);
    throw error;
  }
}

// === Helper to format recurrence ===
function formatRecurrence(schedule) {
  if (!schedule || schedule.repeat_kind === 'none') return 'Does not repeat';
  const { repeat_kind, interval, weekdays, monthday, month } = schedule;

  switch (repeat_kind) {
    case 'daily':
      return `Repeats every ${interval} day(s)`;
    case 'weekly':
      const days = (weekdays || []).map(d =>
        ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]
      ).join(', ');
      return `Repeats every ${interval} week(s) on ${days}`;
    case 'monthly':
      return monthday
        ? `Repeats monthly on day ${monthday}`
        : 'Repeats monthly (pattern variant)';
    case 'yearly':
      return month
        ? `Repeats yearly in month ${month} (interval: ${interval})`
        : 'Repeats yearly';
    default:
      return 'Does not repeat';
  }
}


// Updated email function with modern HTML design
async function sendEmailWithPdf(
  assigned_email,
  task_name,
  maintenance_type,
  task_description,
  machine_name,
  start_date,
  end_date,
  assignedToEmail,
  creator_email,
  pdfBuffer,
  maintenance_id,
  recurrenceText,
  until
) {
  const transporter = nodemailer.createTransport({
    host: "avocarbon-com.mail.protection.outlook.com",
    port: 25,
    secure: false,
    auth: {
      user: "administration.STS@avocarbon.com",
      pass: "shnlgdyfbcztbhxn",
    },
  });

  const formattedUntil = until
    ? new Date(until).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'N/A';

  const mailOptions = {
    from: "administration.STS@avocarbon.com",
    to: assigned_email,
    subject: `New Maintenance Task Assigned - ${task_name}`,
html: `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        background: #f8fafc;
        color: #334155;
        margin: 0;
        padding: 0;
      }

      .container {
        max-width: 600px;
        margin: 40px auto;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        overflow: hidden;
      }

      .header {
        background: linear-gradient(135deg, #1d4ed8, #2563eb);
        padding: 30px 20px;
        text-align: center;
      }

      .header img {
        width: 120px;
        height: auto;
        margin-bottom: 10px;
      }

      .header h1 {
        font-size: 22px;
        font-weight: 700;
        color: #ffffff;
        margin: 0;
        letter-spacing: 0.5px;
      }

      .header p {
        color: #e0e7ff;
        margin: 4px 0 0;
        font-size: 14px;
      }

      .content {
        padding: 40px 30px;
      }

      .section-title {
        color: #2563eb;
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 20px;
        border-bottom: 2px solid #e2e8f0;
        padding-bottom: 10px;
      }

      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      .info-label {
        color: #64748b;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .info-value {
        color: #1e293b;
        font-size: 14px;
        font-weight: 500;
      }

      .description-box {
        background: #f8fafc;
        border-radius: 8px;
        padding: 20px;
        border-left: 4px solid #2563eb;
        margin-top: 20px;
      }

      .footer {
        background: #1e293b;
        color: white;
        padding: 25px 30px;
        text-align: center;
        font-size: 12px;
      }

      @media (max-width: 600px) {
        .info-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <!-- HEADER WITH LOGO -->
      <div class="header">
        <img src="https://media.licdn.com/dms/image/v2/D4E0BAQGYVmAPO2RZqQ/company-logo_200_200/company-logo_200_200/0/1689240189455/avocarbon_group_logo?e=2147483647&v=beta&t=nZNCXd3ypoMFQnQMxfAZrljyNBbp4E5HM11Y1yl9_L0" 
             alt="AVOCARBON Logo" />
        <h1>Maintenance System</h1>
 
      </div>

      <!-- CONTENT -->
      <div class="content">
        <div class="section-title">Maintenance Task Details</div>

        <div class="info-grid">
          <div>
            <div class="info-label">Task Name</div>
            <div class="info-value">${task_name}</div>
          </div>
          <div>
            <div class="info-label">Maintenance Type</div>
            <div class="info-value">${maintenance_type}</div>
          </div>
          <div>
            <div class="info-label">Machine</div>
            <div class="info-value">${machine_name}</div>
          </div>
          <div>
            <div class="info-label">Recurrence</div>
            <div class="info-value">${recurrenceText}</div>
          </div>
          <div>
            <div class="info-label">Recurrence-end_date</div>
            <div class="info-value">${formattedUntil}</div>
          </div>
          <div>
            <div class="info-label">Start Date</div>
            <div class="info-value">${start_date.toLocaleString()}</div>
          </div>
          <div>
            <div class="info-label">End Date</div>
            <div class="info-value">${end_date.toLocaleString()}</div>
          </div>
          <div>
            <div class="info-label">Assigned To</div>
            <div class="info-value">${assigned_email}</div>
          </div>
          <div>
            <div class="info-label">Created By</div>
            <div class="info-value">${creator_email}</div>
          </div>
        </div>

        <div class="description-box">
          <div class="info-label">Task Description</div>
          <div class="info-value">${task_description}</div>
        </div>
      </div>

      <!-- FOOTER -->
      <div class="footer">
        <p>AVOCARBON Maintenance System | Automated Notification</p>
        <p>&copy; ${new Date().getFullYear()} AVOCARBON. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
`,

  };

  await transporter.sendMail(mailOptions);
}




// Create a maintenance entry
router.post('/maintenance', async (req, res) => {
  const {
    maintenance_type,
    task_name,
    task_description,
    completed_date,
    assigned_to,
    creator,
    start_date,
    end_date,
    user_id,
    // Recurrence fields
    recurrence,        // 'none', 'daily', 'weekly', 'monthly', 'yearly'
    interval,          // number
    weekdays,          // array for weekly [1,3]
    monthlyDay,        // for monthly by day (e.g., 15th)
    monthlyMonth,      // month number if needed
    monthlyOrdinal,    // 'first', 'second', etc
    monthlyWeekday,    // 0-6 Sunday-Saturday
    // 🔥 Yearly fields
    yearlyMode,        // 'day' | 'weekday'
    yearlyDay,         // for "day" mode (e.g., 15th)
    yearlyMonth,       // 0–11
    yearlyOrdinal,     // 'first', 'second', 'third', 'fourth', 'last'
    yearlyWeekday,     // 0–6 (Sun–Sat)
    recurrence_end_date
  } = req.body;

  try {
    await pool.query('BEGIN');

    const normalizedStartDate = normalizeDate(start_date);
    const normalizedEndDate = normalizeDate(end_date);
    const normalizedUntilDate = recurrence_end_date ? normalizeDate(recurrence_end_date) : null;

    // Fetch machine_id (temporary: always first machine)
    const machineresult = await pool.query('SELECT machine_id FROM "Machines" LIMIT 1');
    if (machineresult.rows.length === 0) throw new Error("No machine found");
    const machine_id = machineresult.rows[0].machine_id;

    // Insert into PreventiveMaintenance
    const maintenanceResult = await pool.query(
      `INSERT INTO "PreventiveMaintenance" 
        (machine_id, maintenance_type, task_name, task_description, completed_date, task_status, assigned_to, creator, creation_date, start_date, end_date) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) 
       RETURNING maintenance_id`,
      [
        machine_id,
        maintenance_type,
        task_name,
        task_description,
        completed_date,
        'In progress',
        assigned_to,
        creator,
        new Date(),
        normalizedStartDate,
        normalizedEndDate,
      ]
    );

    const maintenance_id = maintenanceResult.rows[0].maintenance_id;

// --- Handle recurrence mapping ---
const ordinals = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

let week_of_month = null;
let weekday = null;
let month = null;
let monthday = null;
let pattern_variant = 'standard';

// Monthly mapping
if (recurrence === 'monthly') {
  if (monthlyOrdinal && monthlyWeekday !== undefined) {
    // Example: Second Tuesday → nth weekday mode
    pattern_variant = 'monthly_nth';
    week_of_month = ordinals[monthlyOrdinal.toLowerCase()] || null; // 2 for second
    weekday = monthlyWeekday; // 0=Sunday, 1=Monday...
    monthday = null; // must be null in this variant
  } else if (monthlyDay) {
    // Example: Every 10th → day-of-month mode
    pattern_variant = 'standard';
    monthday = monthlyDay; // 10
    week_of_month = null;
    weekday = null;
  }
}


// Yearly mapping
if (recurrence === 'yearly') {
  if (yearlyMode === 'day') {
    // Example: April 15 → month=4, monthday=15
    pattern_variant = 'standard'; // yearly "day" = standard (day of month)
    month = (yearlyMonth !== undefined ? yearlyMonth + 1 : normalizedStartDate.getMonth() + 1); // DB months 1–12
    monthday = yearlyDay;
    week_of_month = null;
    weekday = null;
  } else if (yearlyMode === 'weekday') {
    // Example: Second Tuesday in January
    pattern_variant = 'monthly_nth'; // yearly "weekday" = nth weekday of month
    week_of_month = ordinals[yearlyOrdinal?.toLowerCase()] || null;
    weekday = yearlyWeekday;
    month = (yearlyMonth !== undefined ? yearlyMonth + 1 : normalizedStartDate.getMonth() + 1);
    monthday = null;
  }
}

// Insert into Maintenance_schedule
await pool.query(`
  INSERT INTO "Maintenance_schedule"
  (maintenance_id, start_at, end_at, timezone, repeat_kind, interval, weekdays, monthday, month, week_of_month, weekday, pattern_variant, until, notes)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
`, [
  maintenance_id,
  normalizedStartDate,
  normalizedEndDate,
  'Africa/Tunis',
  recurrence || 'none',
  interval || 1,
  weekdays || null,
  monthday,
  month,
  week_of_month,
  weekday,
  pattern_variant,
  normalizedUntilDate,
  task_description
]);

    // PreventiveMaintenance_Hist insert
    await pool.query(
      `INSERT INTO "PreventiveMaintenance_Hist" 
        (maintenance_id, machine_id, maintenance_type, task_name, task_description, start_date, end_date, completed_date, task_status, assigned_to, creator, creation_date, action_type, action_date, user_id) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        maintenance_id,
        machine_id,
        maintenance_type,
        task_name,
        task_description,
        normalizedStartDate,
        normalizedEndDate,
        completed_date,
        'In progress',
        assigned_to,
        creator,
        new Date(),
        'CREATE',
        new Date(),
        user_id
      ]
    );

    // ✅ AUTOMATICALLY GENERATE PDF AND SEND EMAIL
    try {
      await generateAndSendPdf(maintenance_id, machine_id, maintenance_type, task_name, task_description, assigned_to, creator, normalizedStartDate, normalizedEndDate);
      console.log(`PDF generated and email sent for maintenance task ${maintenance_id}`);
    } catch (pdfError) {
      console.error('Error generating PDF or sending email:', pdfError);
      // Don't fail the entire request if PDF generation fails
    }

    await pool.query('COMMIT');

    res.status(201).json({
      id: maintenance_id,
      task_name,
      maintenance_type,
      task_description,
      assigned_to,
      task_status: 'In progress',
      machine_id,
      start_date: normalizedStartDate.toISOString(),
      end_date: normalizedEndDate.toISOString(),
      creator,
      user_id,
      recurrence: recurrence || 'none',
      interval: interval || 1,
      weekdays: weekdays || [],
      // Monthly
      monthly_mode: monthlyDay ? 'day' : (monthlyOrdinal ? 'weekday' : null),
      monthly_day: monthlyDay || null,
      monthly_ordinal: monthlyOrdinal || null,
      monthly_weekday: monthlyWeekday || null,
      // Yearly
      yearly_mode: yearlyMode || null,
      yearly_day: yearlyDay || null,
      yearly_month: yearlyMonth || null,
      yearly_ordinal: yearlyOrdinal || null,
      yearly_weekday: yearlyWeekday || null,
      recurrence_end_date: normalizedUntilDate ? normalizedUntilDate.toISOString() : null,
      week_of_month,
      weekday,
      monthday,
      month
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error adding maintenance record:', err);
    res.status(500).json({ message: 'Error adding maintenance record' });
  }
});

router.get('/maintenance', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pm.maintenance_id AS id,
        pm.task_name,
        pm.start_date,
        pm.end_date,
        pm.maintenance_type,
        pm.task_description,
        pm.completed_date,
        pm.assigned_to,
        u_assigned.email AS assigned_to_email,
        pm.creator,
        u_creator.email AS creator_email,
        pm.task_status,
        pm.machine_id,
        m.machine_ref,
        ms.repeat_kind AS recurrence,
        ms.interval,
        ms.weekdays,
        ms.monthday AS monthly_day,
        ms.week_of_month AS monthly_ordinal,
        ms.weekday AS monthly_weekday,
        ms.pattern_variant,
        ms.month AS yearly_month,
        ms.until AS recurrence_end_date
      FROM "PreventiveMaintenance" pm
      LEFT JOIN "Maintenance_schedule" ms
        ON pm.maintenance_id = ms.maintenance_id
      LEFT JOIN "User" u_assigned
        ON pm.assigned_to = u_assigned.user_id
      LEFT JOIN "User" u_creator
        ON pm.creator = u_creator.user_id
      LEFT JOIN "Machines" m
        ON pm.machine_id = m.machine_id
      ORDER BY pm.start_date DESC
    `);

    const events = result.rows.map(event => ({
      ...event,
      start_date: event.start_date?.toISOString(),
      end_date: event.end_date?.toISOString(),
      recurrence_end_date: event.recurrence_end_date ? event.recurrence_end_date.toISOString() : null
    }));

    res.status(200).json(events);
  } catch (err) {
    console.error("Error fetching maintenance events:", err);
    res.status(500).json({ message: "Error fetching maintenance events" });
  }
});




router.get('/maintenancee', async (req, res) => {
  const { userId, role } = req.query;

  if (!userId || !role) {
    return res.status(400).json({ message: 'User ID and role are required' });
  }

  try {
    let result;

    if (role === 'ADMIN') {
      // Admin gets all maintenance with recurrence data
      result = await pool.query(`
        SELECT 
          pm.maintenance_id AS id, 
          pm.task_name, 
          pm.start_date,
          pm.end_date,
          pm.maintenance_type,
          pm.task_description,
          pm.completed_date,
          pm.assigned_to,
          pm.creator,
          pm.task_status,
          pm.machine_id,
          ms.repeat_kind AS recurrence,
          ms.interval,
          ms.weekdays,
          ms.monthday AS monthly_day,
          ms.week_of_month AS monthly_ordinal,
          ms.weekday AS monthly_weekday,
          ms.pattern_variant,
          ms.month AS yearly_month,
          ms.monthday AS yearly_day,
          ms.week_of_month AS yearly_ordinal,
          ms.weekday AS yearly_weekday,
          ms.until AS recurrence_end_date
        FROM "PreventiveMaintenance" pm
        LEFT JOIN "Maintenance_schedule" ms
          ON pm.maintenance_id = ms.maintenance_id
        ORDER BY pm.start_date DESC
      `);
    } else {
      // Other users get only assigned or created maintenance with recurrence data
      result = await pool.query(`
        SELECT 
          pm.maintenance_id AS id, 
          pm.task_name, 
          pm.start_date,
          pm.end_date,
          pm.maintenance_type,
          pm.task_description,
          pm.completed_date,
          pm.assigned_to,
          pm.creator,
          pm.task_status,
          pm.machine_id,
          ms.repeat_kind AS recurrence,
          ms.interval,
          ms.weekdays,
          ms.monthday AS monthly_day,
          ms.week_of_month AS monthly_ordinal,
          ms.weekday AS monthly_weekday,
          ms.pattern_variant,
          ms.month AS yearly_month,
          ms.monthday AS yearly_day,
          ms.week_of_month AS yearly_ordinal,
          ms.weekday AS yearly_weekday,
          ms.until AS recurrence_end_date
        FROM "PreventiveMaintenance" pm
        LEFT JOIN "Maintenance_schedule" ms
          ON pm.maintenance_id = ms.maintenance_id
        WHERE pm.assigned_to = $1 OR pm.creator = $1
        ORDER BY pm.start_date DESC
      `, [userId]);
    }

    const events = result.rows.map(event => ({
      ...event,
      start: event.start_date,
      end: event.end_date,
      start_date: event.start_date.toISOString(),
      end_date: event.end_date.toISOString(),
      recurrence_end_date: event.recurrence_end_date ? event.recurrence_end_date.toISOString() : null
    }));

    res.status(200).json(events);
  } catch (err) {
    console.error("Error fetching maintenance events:", err);
    res.status(500).json({ message: "Error fetching maintenance events" });
  }
});

//historymodification
router.get('/maintenance/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      WITH hist AS (
        SELECT
          h.action_date,
          h.action_type,
          h.user_id,
          u.email AS modified_by,
          
          -- Main fields
          h.machine_id,
          h.maintenance_type,
          h.task_name,
          h.task_description,
          h.start_date,
          h.end_date,
          h.completed_date,
          h.task_status,
          h.assigned_to,
          h.creator,
          
          -- Recurrence fields
          h.frequency,
          h."interval",
          h.weekdays,
          h.monthly_day,
          h.monthly_ordinal,
          h.monthly_weekday,
          h.yearly_month,
          h.recurrence_end_date,

          -- Previous values for ALL fields (window)
          LAG(h.machine_id)           OVER (ORDER BY h.action_date) AS prev_machine_id,
          LAG(h.maintenance_type)     OVER (ORDER BY h.action_date) AS prev_maintenance_type,
          LAG(h.task_name)            OVER (ORDER BY h.action_date) AS prev_task_name,
          LAG(h.task_description)     OVER (ORDER BY h.action_date) AS prev_task_description,
          LAG(h.start_date)           OVER (ORDER BY h.action_date) AS prev_start_date,
          LAG(h.end_date)             OVER (ORDER BY h.action_date) AS prev_end_date,
          LAG(h.completed_date)       OVER (ORDER BY h.action_date) AS prev_completed_date,
          LAG(h.task_status)          OVER (ORDER BY h.action_date) AS prev_task_status,
          LAG(h.assigned_to)          OVER (ORDER BY h.action_date) AS prev_assigned_to,
          LAG(h.creator)              OVER (ORDER BY h.action_date) AS prev_creator,
          
          LAG(h.frequency)            OVER (ORDER BY h.action_date) AS prev_frequency,
          LAG(h."interval")           OVER (ORDER BY h.action_date) AS prev_interval,
          LAG(h.weekdays)             OVER (ORDER BY h.action_date) AS prev_weekdays,
          LAG(h.monthly_day)          OVER (ORDER BY h.action_date) AS prev_monthly_day,
          LAG(h.monthly_ordinal)      OVER (ORDER BY h.action_date) AS prev_monthly_ordinal,
          LAG(h.monthly_weekday)      OVER (ORDER BY h.action_date) AS prev_monthly_weekday,
          LAG(h.yearly_month)         OVER (ORDER BY h.action_date) AS prev_yearly_month,
          LAG(h.recurrence_end_date)  OVER (ORDER BY h.action_date) AS prev_recurrence_end_date
        FROM public."PreventiveMaintenance_Hist" h
        JOIN public."User" u ON u.user_id = h.user_id
        WHERE h.maintenance_id = $1
        ORDER BY h.action_date ASC
      )

      SELECT *
      FROM hist
      WHERE
        -- Check ALL fields for changes
        (machine_id          IS DISTINCT FROM prev_machine_id)
        OR (maintenance_type IS DISTINCT FROM prev_maintenance_type)
        OR (task_name        IS DISTINCT FROM prev_task_name)
        OR (task_description IS DISTINCT FROM prev_task_description)
        OR (start_date       IS DISTINCT FROM prev_start_date)
        OR (end_date         IS DISTINCT FROM prev_end_date)
        OR (completed_date   IS DISTINCT FROM prev_completed_date)
        OR (task_status      IS DISTINCT FROM prev_task_status)
        OR (assigned_to      IS DISTINCT FROM prev_assigned_to)
        OR (creator          IS DISTINCT FROM prev_creator)
        OR (frequency        IS DISTINCT FROM prev_frequency)
        OR ("interval"       IS DISTINCT FROM prev_interval)
        OR (weekdays         IS DISTINCT FROM prev_weekdays)
        OR (monthly_day      IS DISTINCT FROM prev_monthly_day)
        OR (monthly_ordinal  IS DISTINCT FROM prev_monthly_ordinal)
        OR (monthly_weekday  IS DISTINCT FROM prev_monthly_weekday)
        OR (yearly_month     IS DISTINCT FROM prev_yearly_month)
        OR (recurrence_end_date IS DISTINCT FROM prev_recurrence_end_date)
      ORDER BY action_date DESC;
      `,
      [req.params.id]
    );

    console.log(`Found ${rows.length} history records for maintenance ${req.params.id}`);

    // Transform results into change-based history
    const history = rows.map(r => {
      const changes = {};

      const cmp = (oldVal, newVal, key) => {
        const normalize = (v, field) => {
          if (v == null) return null;
          if (field === 'weekdays' && Array.isArray(v)) return [...v].sort((a, b) => a - b);
          return v;
        };
        const oldN = normalize(oldVal, key);
        const newN = normalize(newVal, key);
        if (JSON.stringify(oldN) !== JSON.stringify(newN)) {
          changes[key] = { old: oldN, new: newN };
        }
      };

      // Compare ALL fields
      const fields = [
        // Main fields
        'machine_id',
        'maintenance_type', 
        'task_name',
        'task_description',
        'start_date',
        'end_date',
        'completed_date',
        'task_status',
        'assigned_to',
        'creator',
        
        // Recurrence fields
        'frequency',
        'interval',
        'weekdays',
        'monthly_day',
        'monthly_ordinal',
        'monthly_weekday',
        'yearly_month',
        'recurrence_end_date'
      ];

      fields.forEach(k => cmp(r[`prev_${k}`], r[k], k));

      return {
        action_date: r.action_date,
        modified_by: r.modified_by,
        changes
      };
    }).filter(h => Object.keys(h.changes).length > 0);

    console.log(`Returning ${history.length} filtered history records with changes`);
    return res.json(history);
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ message: 'Error fetching history' });
  }
});




router.put("/maintenance/:id", async (req, res) => {
  const { id } = req.params;
  const {
    machine_id,
    maintenance_type,
    task_name,
    task_description,
    start_date,
    end_date,
    completed_date,
    task_status,
    assigned_to,
    creator,
    user_id,
    recurrence,
  } = req.body;

  const mapMonthlyOrdinal = (ordinal) => {
    if (!ordinal) return null;
    const mapping = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      last: 5,
    };
    return mapping[ordinal] || null;
  };

  const mapMonthlyWeekday = (weekday) => {
    if (weekday === null || weekday === undefined) return null;
    return parseInt(weekday);
  };

  // ALWAYS return a non-null pattern variant (use 'standard' as safe default)
  const determinePatternVariant = (frequency, monthlyDay, weekOfMonth, weekday) => {
    if (frequency === "monthly" || frequency === "yearly") {
      if (monthlyDay !== null && monthlyDay !== undefined) return "standard";
      if (weekOfMonth !== null && weekday !== null && weekOfMonth !== undefined && weekday !== undefined) return "monthly_nth";
      return "standard";
    }
    // For daily/weekly/others use 'standard' so column is never null
    return "standard";
  };

  console.log(`Updating maintenance ${id}`, {
    machine_id,
    maintenance_type,
    task_name,
    task_status,
    assigned_to,
    recurrence: recurrence ? "present" : "absent",
  });

  try {
    // Step 1: fetch old row
    const oldResult = await pool.query(
      `SELECT * FROM "PreventiveMaintenance" WHERE maintenance_id = $1`,
      [id]
    );
    const oldData = oldResult.rows[0];
    if (!oldData) return res.status(404).json({ message: "Maintenance task not found" });

    // Step 2: update main record
    await pool.query(
      `UPDATE "PreventiveMaintenance"
       SET machine_id = $1,
           maintenance_type = $2,
           task_name = $3,
           task_description = $4,
           start_date = $5,
           end_date = $6,
           completed_date = $7,
           task_status = $8,
           assigned_to = $9,
           creator = $10
       WHERE maintenance_id = $11`,
      [
        machine_id,
        maintenance_type,
        task_name,
        task_description,
        start_date,
        end_date,
        completed_date,
        task_status,
        assigned_to,
        creator,
        id,
      ]
    );

    // Step 3: handle recurrence / schedule
    let recurrenceData = {};
    let scheduleChanges = [];

    if (recurrence) {
      const {
        frequency,
        interval,
        weekdays,
        monthly_day,
        monthly_ordinal,
        monthly_weekday,
        yearly_month,
        recurrence_end_date,
      } = recurrence;

      // Map and parse incoming values
      let finalMonthlyDay = (monthly_day !== null && monthly_day !== undefined) ? parseInt(monthly_day) : null;
      let finalWeekOfMonth = mapMonthlyOrdinal(monthly_ordinal);
      let finalWeekday = mapMonthlyWeekday(monthly_weekday);

      // If frequency not monthly, ensure monthly fields are null
      if (frequency !== "monthly") {
        finalMonthlyDay = null;
        finalWeekOfMonth = null;
        finalWeekday = null;
      } else {
        // frequency === 'monthly' -> ensure only one pattern is used and provide a safe default
        if (finalMonthlyDay && (finalWeekOfMonth || finalWeekday)) {
          // prefer day-of-month
          finalWeekOfMonth = null;
          finalWeekday = null;
        } else if (finalWeekOfMonth && finalWeekday) {
          finalMonthlyDay = null;
        } else if (!finalMonthlyDay && !(finalWeekOfMonth && finalWeekday)) {
          // nothing provided — fallback to day=1 (standard)
          finalMonthlyDay = 1;
          finalWeekOfMonth = null;
          finalWeekday = null;
        }
      }

      // Determine pattern variant (non-null)
      let patternVariant = determinePatternVariant(frequency, finalMonthlyDay, finalWeekOfMonth, finalWeekday);

      // If patternVariant indicates monthly_nth but fields missing -> fallback to standard
      if (frequency === "monthly" && patternVariant === "monthly_nth" && (finalWeekOfMonth === null || finalWeekday === null)) {
        finalMonthlyDay = 1;
        finalWeekOfMonth = null;
        finalWeekday = null;
        patternVariant = "standard";
      }

      // Make sure rrule is explicitly null (DB constraint logic references it)
      const rruleValue = null;

      // Fetch existing schedule
      const existingSchedule = await pool.query(
        `SELECT * FROM "Maintenance_schedule" WHERE maintenance_id = $1`,
        [id]
      );

      const dbFields = {
        repeat_kind: frequency,
        interval: interval,
        weekdays: weekdays,
        monthday: finalMonthlyDay,
        week_of_month: finalWeekOfMonth,
        weekday: finalWeekday,
        month: yearly_month,
        until: recurrence_end_date,
        pattern_variant: patternVariant,
        rrule: rruleValue,
      };

      if (existingSchedule.rowCount > 0) {
        const oldSchedule = existingSchedule.rows[0];
        // detect changes
        for (const [dbField, newValue] of Object.entries(dbFields)) {
          const oldValue = oldSchedule[dbField];
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            scheduleChanges.push(dbField);
          }
        }

        // update
        await pool.query(
          `UPDATE "Maintenance_schedule"
           SET repeat_kind = $1,
               interval = $2,
               weekdays = $3,
               monthday = $4,
               week_of_month = $5,
               weekday = $6,
               month = $7,
               until = $8,
               pattern_variant = $9,
               rrule = $10
           WHERE maintenance_id = $11`,
          [
            frequency,
            interval,
            weekdays,
            finalMonthlyDay,
            finalWeekOfMonth,
            finalWeekday,
            yearly_month,
            recurrence_end_date,
            patternVariant,
            rruleValue,
            id,
          ]
        );
      } else {
        // insert (make sure columns and values line up)
        scheduleChanges = Object.keys(dbFields);
        await pool.query(
          `INSERT INTO "Maintenance_schedule"
           (maintenance_id, repeat_kind, interval, weekdays, monthday, week_of_month, weekday, month, until, pattern_variant, rrule)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            frequency,
            interval,
            weekdays,
            finalMonthlyDay,
            finalWeekOfMonth,
            finalWeekday,
            yearly_month,
            recurrence_end_date,
            patternVariant,
            rruleValue,
          ]
        );
      }

      recurrenceData = {
        frequency,
        interval,
        weekdays,
        monthly_day: finalMonthlyDay,
        monthly_ordinal: finalWeekOfMonth,
        monthly_weekday: finalWeekday,
        yearly_month,
        recurrence_end_date,
        pattern_variant: patternVariant,
      };
    } else {
      // no recurrence -> delete any existing schedule
      const existingSchedule = await pool.query(
        `SELECT * FROM "Maintenance_schedule" WHERE maintenance_id = $1`,
        [id]
      );
      if (existingSchedule.rowCount > 0) {
        scheduleChanges = ["recurrence_removed"];
        await pool.query(`DELETE FROM "Maintenance_schedule" WHERE maintenance_id = $1`, [id]);
      }
    }

    // Step 4: fetch updated main row
    const newResult = await pool.query(
      `SELECT * FROM "PreventiveMaintenance" WHERE maintenance_id = $1`,
      [id]
    );
    const newData = newResult.rows[0];

    // Step 5: detect changes
    const changedFields = [];
    for (const key in newData) {
      if (
        key !== "creation_date" &&
        key !== "maintenance_id" &&
        JSON.stringify(newData[key]) !== JSON.stringify(oldData[key])
      ) {
        changedFields.push(key);
      }
    }

    // Add schedule changes mapped to frontend names
    if (scheduleChanges.length > 0) {
      const fieldMapping = {
        repeat_kind: "frequency",
        interval: "interval",
        weekdays: "weekdays",
        monthday: "monthly_day",
        week_of_month: "monthly_ordinal",
        weekday: "monthly_weekday",
        month: "yearly_month",
        until: "recurrence_end_date",
        recurrence_removed: "recurrence_removed",
      };
      scheduleChanges.forEach((dbField) => {
        const frontendField = fieldMapping[dbField];
        if (frontendField && !changedFields.includes(frontendField)) {
          changedFields.push(frontendField);
        }
      });
    }

    // Step 6: write history if any changes
    if (changedFields.length > 0) {
      await pool.query(
        `INSERT INTO "PreventiveMaintenance_Hist" 
         (maintenance_id, machine_id, maintenance_type, task_name, task_description, 
          start_date, end_date, completed_date, task_status, assigned_to, 
          creator, creation_date, action_type, action_date, user_id,
          frequency, "interval", weekdays, monthly_day, monthly_ordinal, monthly_weekday, yearly_month, recurrence_end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          newData.maintenance_id,
          newData.machine_id,
          newData.maintenance_type,
          newData.task_name,
          newData.task_description,
          newData.start_date,
          newData.end_date,
          newData.completed_date,
          newData.task_status,
          newData.assigned_to,
          newData.creator,
          newData.creation_date,
          "UPDATE",
          new Date(),
          user_id,
          recurrenceData.frequency || null,
          recurrenceData.interval || null,
          recurrenceData.weekdays || null,
          recurrenceData.monthly_day || null,
          recurrenceData.monthly_ordinal || null,
          recurrenceData.monthly_weekday || null,
          recurrenceData.yearly_month || null,
          recurrenceData.recurrence_end_date || null,
        ]
      );
    }

    res.json({
      message:
        changedFields.length > 0
          ? "Maintenance updated and history recorded"
          : "Maintenance updated (no changes detected)",
      changedFields,
    });
  } catch (err) {
    console.error("Error updating maintenance:", err);
    res.status(500).json({ message: "Server error" });
  }
});



router.delete('/maintenance/:maintenance_id', async (req, res) => {
  const { maintenance_id } = req.params;
  const { user_id } = req.body;

  console.log(`Received DELETE for maintenance_id: ${maintenance_id} by user: ${user_id}`);

  if (!user_id) {
    return res.status(400).json({ message: 'Missing user_id in request body.' });
  }

  try {
    await pool.query('BEGIN');

    const maintenanceId = parseInt(maintenance_id);

    // Step 1: Fetch the maintenance task
    const maintenanceResult = await pool.query(
      `SELECT * FROM "PreventiveMaintenance" WHERE maintenance_id = $1`,
      [maintenanceId]
    );

    if (maintenanceResult.rows.length === 0) {
      throw new Error(`Maintenance task with ID ${maintenance_id} not found`);
    }

    const maintenance = maintenanceResult.rows[0];
    console.log('Found maintenance record:', maintenance);

    // Step 2: Insert into history table
    const insertHistResult = await pool.query(
      `INSERT INTO "PreventiveMaintenance_Hist" 
        (maintenance_id, machine_id, maintenance_type, task_name, task_description, start_date, end_date, completed_date, task_status, assigned_to, creator, creation_date, action_type, action_date, user_id)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        maintenance.maintenance_id,
        maintenance.machine_id,
        maintenance.maintenance_type,
        maintenance.task_name,
        maintenance.task_description,
        maintenance.start_date,
        maintenance.end_date,
        maintenance.completed_date,
        maintenance.task_status,
        maintenance.assigned_to,
        maintenance.creator,
        new Date(),       // creation_date
        'DELETE',         // action_type
        new Date(),       // action_date
        user_id
      ]
    );

    console.log('Inserted into history:', insertHistResult.rows[0]);

    // Step 3: Delete from original table
    const deleteResult = await pool.query(
      `DELETE FROM "PreventiveMaintenance" WHERE maintenance_id = $1`,
      [maintenanceId]
    );

    console.log('Deleted rows count:', deleteResult.rowCount);

    await pool.query('COMMIT');

    res.status(200).json({
      message: 'Maintenance task deleted and history logged successfully.',
      deleted_maintenance_id: maintenanceId
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error deleting maintenance task:', error.message);
    res.status(500).json({
      message: 'Failed to delete maintenance task',
      error: error.message
    });
  }
});



router.put('/update-role/:id', async (req, res) => {
  const { role } = req.body;
  const { id } = req.params;

  try {
    await pool.query('UPDATE "User" SET role = $1 WHERE user_id = $2', [role, id]);
    res.json({ message: 'Role updated successfully' });
  } catch (err) {
    console.error('Error updating role:', err);
    res.status(500).json({ message: 'Failed to update role' });
  }
});



{/*maintenace task reviews*/}
// Submit maintenance task for review
router.post('/maintenance/:id/review', async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;

  try {
    await pool.query('BEGIN');

    const taskResult = await pool.query(
      `SELECT * FROM "PreventiveMaintenance" WHERE maintenance_id = $1`,
      [id]
    );

    if (taskResult.rowCount === 0) {
      throw new Error('Maintenance task not found');
    }

    const task = taskResult.rows[0];

 if (Number(task.assigned_to) !== Number(user_id)) {
  throw new Error('Only assigned executor can request review');
}


    // Update status
    await pool.query(
      `UPDATE "PreventiveMaintenance" SET task_status = 'Pending Review' WHERE maintenance_id = $1`,
      [id]
    );

    // Insert review record
    const reviewResult = await pool.query(
      `INSERT INTO "Maintenance_task_reviews" (maintenance_id, demand_date, demanded_by) VALUES ($1, $2, $3) RETURNING demand_id`,
      [id, new Date(), user_id]
    );


      // Emit notification to Manager (creator)
// Emit notification to Manager (creator)
    const connectedUsers = getConnectedUsers();
    const io = getIo();

    const managerSocketId = connectedUsers[task.creator];
    if (managerSocketId && io) {
      io.to(managerSocketId).emit('new-notification', {
        message: `Executor requested review for task "${task.task_name}"`,
        from: task.assigned_to,
        type: 'review-request',
        maintenance_id: id,
      });
    }

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Review request submitted successfully',
      demand_id: reviewResult.rows[0].demand_id
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error submitting review:', err.message);
    res.status(500).json({ message: err.message });
  }
});



// Get pending reviews (for managers)
router.get('/maintenance/reviews/pending/:managerId', async (req, res) => {
  const { managerId } = req.params;

  try {
    const result = await pool.query(`
      SELECT r.demand_id, r.demand_date, 
             p.maintenance_id, p.task_name, p.task_description,
             p.assigned_to, p.creator, p.machine_id
      FROM "Maintenance_task_reviews" r
      JOIN "PreventiveMaintenance" p ON r.maintenance_id = p.maintenance_id
      WHERE r.response IS NULL AND p.creator = $1
      ORDER BY r.demand_date DESC
    `, [managerId]);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching pending reviews:', err);
    res.status(500).json({ message: 'Error fetching pending reviews' });
  }
});


// Process review response (for managers)
router.patch('/maintenance/reviews/:id', async (req, res) => {
  const { id } = req.params;
  const { response, feedback, user_id } = req.body;

  try {
    await pool.query('BEGIN');

    // Update review record and return maintenance_id and demand_date
    const updateReview = await pool.query(
      `UPDATE "Maintenance_task_reviews" 
       SET response = $1, feedback = $2, response_date = NOW()
       WHERE demand_id = $3
       RETURNING maintenance_id, demand_date, demanded_by`,
      [response, feedback, id]
    );

    const { maintenance_id, demand_date, demanded_by } = updateReview.rows[0];

    // Update maintenance task status
if (response === 'Accepted') {
  await pool.query(
    `UPDATE "PreventiveMaintenance"
     SET task_status = $1,
     completed_date = CURRENT_DATE
     WHERE maintenance_id = $2`,
    ['Completed', updateReview.rows[0].maintenance_id]
  );
}



    // Insert into review history
    await pool.query(
      `INSERT INTO "Maintenance_task_reviews_Hist" 
        (demand_id, maintenance_id, demand_date, response, response_date, feedback, review_status, demanded_by, action_type, action_date, responded_by) 
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, NOW(), $9)`,
      [
        id,
        maintenance_id,
        demand_date,
        response,
        feedback,
        'Responded',     // Assuming the status after response is RESPONDED
        demanded_by,
        'UPDATE',        // Assuming the action type is UPDATE
        user_id
      ]
    );

    if (response === 'Accepted') {
  await pool.query(
    `UPDATE "PreventiveMaintenance"
     SET completed_date = NOW()
     WHERE maintenance_id = $1`,
    [updateReview.rows[0].maintenance_id]
  );
}

    await pool.query('COMMIT');
    res.status(200).json({ message: 'Review response processed successfully' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error processing review:', err);
    res.status(500).json({ message: 'Error processing review response' });
  }
});



router.get('/executor/:executorId', async (req, res) => {
  const { executorId } = req.params;

  try {
    const result = await pool.query(
      `SELECT pm.*, m.name AS machine_name
       FROM "PreventiveMaintenance" pm
       JOIN "Machines" m ON pm.machine_id = m.machine_id
       WHERE pm.assigned_to = $1
       ORDER BY pm.start_date DESC`,
      [executorId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching executor tasks:', err);
    res.status(500).json({ message: 'Error fetching executor tasks' });
  }
});


// Get detailed info for a single review by demandId
router.get('/maintenance/reviews/:demandId', async (req, res) => {
  const { demandId } = req.params;
  try {
    const result = await pool.query(
      `SELECT r.demand_id, r.demand_date, r.response, r.feedback, r.response_date, 
              p.maintenance_id, p.task_name, p.task_description, p.assigned_to, p.creator, p.machine_id, p.task_status
       FROM "Maintenance_task_reviews" r
       JOIN "PreventiveMaintenance" p ON r.maintenance_id = p.maintenance_id
       WHERE r.demand_id = $1`,
      [demandId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching review details:', error);
    res.status(500).json({ message: 'Error fetching review details' });
  }
});

router.get('/maintenance/reviews/by-maintenance/:maintenanceId', async (req, res) => {
  const { maintenanceId } = req.params;
  try {
    const result = await pool.query(
      `SELECT r.feedback
       FROM "Maintenance_task_reviews" r
       WHERE r.maintenance_id = $1`,
      [maintenanceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching review details:', error);
    res.status(500).json({ message: 'Error fetching review details' });
  }
});


// Process review response (validate or reject with feedback)
router.patch('/maintenance/reviews/:demandId', async (req, res) => {
  const { demandId } = req.params;
  const { response, feedback, user_id } = req.body;

  if (!['Accepted', 'Rejected'].includes(response)) {
    return res.status(400).json({ message: 'Invalid response value' });
  }


  try {
    await pool.query('BEGIN');

    // Update the review row
    const updateReview = await pool.query(
      `UPDATE "Maintenance_task_reviews"
       SET response = $1, feedback = $2, response_date = NOW()
       WHERE demand_id = $3
       RETURNING maintenance_id`,
      [response, feedback, demandId]
    );

    if (updateReview.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ message: 'Review not found' });
    }

// Update the maintenance task status
if (response === 'Accepted') {
  await pool.query(
    `UPDATE "PreventiveMaintenance"
     SET task_status = $1
     WHERE maintenance_id = $2`,
    ['Completed', updateReview.rows[0].maintenance_id]
  );
}


await pool.query(
  `INSERT INTO "Maintenance_task_reviews_Hist" 
   (demand_id, maintenance_id, demand_date, response,
    response_date, feedback, review_status, demanded_by,
    action_type, action_date, responded_by) 
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  [
    demandId,
    updateReview.rows[0].maintenance_id,
    updateReview.rows[0].demand_date,
    response,
    new Date(),
    feedback,
    'Completed',
    updateReview.rows[0].demanded_by,
    'REVIEW_RESPONSE',
    new Date(),
    user_id
  ]
);

    await pool.query('COMMIT');
    res.status(200).json({ message: 'Review response processed successfully' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error processing review response:', err);
    res.status(500).json({ message: 'Error processing review response' });
  }
});
router.get('/maintenance/reviews/maintenance/:maintenanceId', async (req, res) => {
  const { maintenanceId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM "Maintenance_task_reviews" WHERE maintenance_id = $1 ORDER BY response_date DESC`,
      [maintenanceId]
    );

    res.json(result.rows); // Return all reviews for that maintenance_id
  } catch (error) {
    console.error('Error fetching maintenance reviews:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance reviews' });
  }
});

router.put('/tasks/:id/status', async (req, res) => {
  const taskId = req.params.id;
  const { task_status } = req.body;

  console.log(`PUT /tasks/${taskId}/status called with status: ${task_status}`);

  try {
    // 1. Update task status in DB
    await pool.query(
      'UPDATE "PreventiveMaintenance" SET task_status = $1 WHERE maintenance_id = $2',
      [task_status, taskId]
    );
    console.log(`Task ${taskId} status updated to ${task_status} in DB.`);

    // 2. If status is 'In progress', check the end_date
    if (task_status === 'In progress') {
      console.log(`Task ${taskId} is in progress - checking deadline...`);

      const result = await pool.query(
        `SELECT pm.task_name, pm.end_date, u.email 
         FROM "PreventiveMaintenance" pm
         JOIN "User" u ON pm.assigned_to = u.user_id
         WHERE pm.maintenance_id = $1`,
        [taskId]
      );

      if (result.rows.length > 0) {
        const { end_date, email: assignedEmail, task_name: taskName } = result.rows[0];

        const currentDate = new Date();
        const endDate = new Date(end_date);
        const timeDiff = endDate - currentDate;
        const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)); // Convert ms to days

        console.log(`Days left until end_date: ${daysLeft}`);

        if (daysLeft <= 2 && daysLeft >= 0) {
          console.log(`Sending approaching deadline email to ${assignedEmail}`);

          const subject = `Task "${taskName}" deadline is near`;
          const body = `Hello,\n\nThe task "${taskName}" is still in progress and its deadline is in ${daysLeft} day(s). Please ensure it is completed on time.\n\nRegards,\nYour Company`;

          
          console.log(`Email sent successfully to ${assignedEmail}`);
        } else {
          console.log(`No email sent - deadline is not within 2 days.`);
        }
      } else {
        console.log(`No assigned user found for task ${taskId}`);
      }
    }

    res.json({ message: 'Task status updated successfully' });
  } catch (error) {
    console.error('Error updating task status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// restrictions for the managers 

router.get('/manager-executors/:managerId', async (req, res) => {   
  const { managerId } = req.params;
  
  try {     
    const result = await pool.query(       
      `SELECT u.user_id, u.email         
       FROM "User" u
       INNER JOIN "TeamAssignments" mea ON u.user_id = mea.executor_id        
       WHERE u.role = 'EXECUTOR' 
       AND mea.manager_id = $1
       ORDER BY u.email`,
       [managerId]     
    );      
    
    res.json(result.rows);   
  } catch (err) {     
    console.error('Error fetching manager executors:', err);     
    res.status(500).json({ message: 'Error fetching manager executors' });   
  } 
});

router.post('/assign-team', async (req, res) => {
  const { managerId, executorIds } = req.body;

  if (!managerId || !Array.isArray(executorIds)) {
    return res.status(400).json({ message: 'managerId and executorIds are required' });
  }

  try {
    // Validate manager exists
    const managerCheck = await pool.query('SELECT * FROM "User" WHERE user_id = $1', [managerId]);
    if (managerCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Manager not found' });
    }

    // Remove executors not in the new list (unassign them)
    await pool.query(
      `DELETE FROM "TeamAssignments"
       WHERE manager_id = $1
       AND executor_id NOT IN (SELECT unnest($2::int[]))`,
      [managerId, executorIds]
    );

    // Add new assignments (ignore if already exists)
    const insertPromises = executorIds.map(executorId =>
      pool.query(
        `INSERT INTO "TeamAssignments" (manager_id, executor_id)
         VALUES ($1, $2)
         ON CONFLICT (manager_id, executor_id) DO NOTHING`,
        [managerId, executorId]
      )
    );
    await Promise.all(insertPromises);

    res.status(200).json({ message: 'Team updated successfully' });
  } catch (err) {
    console.error('Assign Team Error:', err);
    res.status(500).json({ message: 'Failed to update team', error: err.message });
  }
});

router.get('/team-executors/:managerId', async (req, res) => {
  const { managerId } = req.params;

  if (!managerId) {
    return res.status(400).json({ message: 'managerId parameter is required' });
  }

  try {
    // Get all executor IDs assigned to this manager
    const assignmentsResult = await pool.query(
      `SELECT executor_id FROM "TeamAssignments" WHERE manager_id = $1`,
      [managerId]
    );

    const executorIds = assignmentsResult.rows.map(row => row.executor_id);

    if (executorIds.length === 0) {
      return res.status(200).json({ executors: [] }); // no executors assigned
    }

    // Fetch executor details from User table
    const executorsResult = await pool.query(
      `SELECT user_id, email FROM "User" WHERE user_id = ANY($1::int[])`,
      [executorIds]
    );

    res.status(200).json({ executors: executorsResult.rows });
  } catch (err) {
    console.error('Fetch Executors Error:', err);
    res.status(500).json({ message: 'Failed to fetch executors', error: err.message });
  }
});

router.get('/available-executors', async (req, res) => {   
  try {     
    const result = await pool.query(       
      `SELECT u.user_id, u.email         
       FROM "User" u        
       WHERE u.role = 'EXECUTOR'
       ORDER BY u.email`     
    );      
    
    res.json(result.rows);   
  } catch (err) {     
    console.error('Error fetching available executors:', err);     
    res.status(500).json({ message: 'Error fetching available executors' });   
  } 
});


router.get('/alerts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        sa.creation_date,
        sa."Type",
        sa.has_code AS maintenance_id,
        pm.task_name,
        assigned_user.email AS assigned_to_email,
        creator_user.email AS creator_email
      FROM "SystemAlerts" sa
      LEFT JOIN "PreventiveMaintenance" pm 
        ON sa.has_code = pm.maintenance_id
      LEFT JOIN "User" assigned_user
        ON pm.assigned_to = assigned_user.user_id
      LEFT JOIN "User" creator_user
        ON pm.creator = creator_user.user_id
    `);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching alerts:", err);
    res.status(500).json({ message: "Error fetching alerts" });
  }
});




module.exports = router;
