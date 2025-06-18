const { sendEmail } = require('./sendMail');
const pool = require('../db');

function scheduleAlertsForTask(task) {
  const { task_name, start_date, end_date, maintenance_id, email } = task;

  const start = new Date(start_date);
  const end = new Date(end_date);
  const now = new Date();

  const totalDuration = end - start;
  const timeTo80Percent = start.getTime() + totalDuration * 0.8 - now.getTime();
  const timeToExactEnd = end.getTime() - now.getTime();
  const timeToLevel3SameDay = end.getTime() + 2 * 60 * 60 * 1000 - now.getTime(); // 2 hours after
  const timeToLevel3DifferentDay = end.getTime() + 2 * 24 * 60 * 60 * 1000 - now.getTime(); // 2 days after

  const isSameDay = start.toDateString() === end.toDateString();

  // 🟡 Level 1 Alert
  if (timeTo80Percent > 0) {
    setTimeout(() => {
      sendAlert(email, task_name, maintenance_id, end, 'Level 1');
    }, timeTo80Percent);
  }

  // 🟠 Level 2 Alert
  if (timeToExactEnd > 0) {
    setTimeout(() => {
      sendAlert(email, task_name, maintenance_id, end, 'Level2');
    }, timeToExactEnd);
  }

  // 🔴 Level 3 Alert
  if (isSameDay && timeToLevel3SameDay > 0) {
    setTimeout(() => {
      sendAlert(email, task_name, maintenance_id, end, 'Level3');
    }, timeToLevel3SameDay);
  } else if (!isSameDay && timeToLevel3DifferentDay > 0) {
    setTimeout(() => {
      sendAlert(email, task_name, maintenance_id, end, 'Level3');
    }, timeToLevel3DifferentDay);
  }
}

async function sendAlert(email, task_name, maintenance_id, endDate, level) {
  const subject = `⚠️ Task "${task_name}" alert - ${level}`;
  const timeDiff = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
  const overdueMsg = level === 'Level3'
    ? 'The task is overdue!'
    : `Deadline is approaching in ${timeDiff} day(s).`;

  const body = `Hello,\n\nThe task "${task_name}" is still in progress.\n${overdueMsg}\n\nPlease take action.\n\nRegards,\nYour Company`;

  await sendEmail(email, subject, body);
  console.log(`📧 ${level} email sent to ${email} for task "${task_name}"`);

  await pool.query(
    `INSERT INTO "SystemAlerts" (creation_date, has_code, "Type")
     VALUES ($1, $2, $3) RETURNING *`,
    [new Date(), maintenance_id, level]
  );
  console.log(`⚠️ ${level} system alert created for maintenance ID ${maintenance_id}`);
}

module.exports = scheduleAlertsForTask;
