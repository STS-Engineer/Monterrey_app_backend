const fs = require("fs");
const nodemailer = require("nodemailer");
const pool = require("../db");
// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: "avocarbon-com.mail.protection.outlook.com",
  port: 25,
  secure: false,
  auth: {
    user: "administration.STS@avocarbon.com",
    pass: "shnlgdyfbcztbhxn",
  },
});

// Test the connection
transporter.verify(function (error, success) {
  if (error) {
    console.log("Error connecting to SMTP server:", error);
  } else {
    console.log("Server is ready to take messages");
  }
});

// Generate an email template with a logo
function generateEmailTemplate(subject, message) {
 
  return `
    <html>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: auto; background-color: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);">
          <header style="text-align: center; margin-bottom: 20px;">
           
          </header>
          <p style="font-size: 16px; line-height: 1.6; color: #555;">${message}</p>
          <footer style="margin-top: 20px; text-align: center; color: #888; font-size: 10px;">
            <p>&copy; ${new Date().getFullYear()} Administration STS. All rights reserved.</p>
          </footer>
        </div>
      </body>
    </html>
  `;
}

// Send an email with optional attachments
async function sendEmail(to, subject, text, attachments = []) {
  const htmlContent = generateEmailTemplate(subject, text);

  try {
    await transporter.sendMail({
      from: "administration.sts@avocarbon.com",
      to,
      subject,
      text,
      html: htmlContent,
      attachments,
    });
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error("Error sending email", error);
  }
}

// Fetch user email by user ID
async function getUserEmailById(userId) {
  try {
    const result = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      throw new Error(`No user found with ID ${userId}`);
    }
    return result.rows[0].email;
  } catch (error) {
    console.error("Error fetching user email:", error.message);
    throw error;
  }
}

// Dynamically send an email notification to the approver or employee
async function sendEmailNotification(userId, subject, message, details) {
  try {
    const userEmail = await getUserEmailById(userId);
    await sendEmail(userEmail, subject, message, details);
  } catch (error) {
    console.error("Error sending notification:", error.message);
  }
}

module.exports = { sendEmail, sendEmailNotification };