const pool = require('../db');
const { sendEmail } = require('../services/sendMail');

async function checkUpcomingDeadlines() {
  const currentDate = new Date();
  const currentTime = currentDate.getTime();

  try {
    const result = await pool.query(
      `SELECT pm.task_name, pm.start_date, pm.end_date, pm.maintenance_id, u.email 
       FROM "PreventiveMaintenance" pm
       JOIN "User" u ON pm.assigned_to = u.user_id
       WHERE pm.task_status = 'In progress'`
    );

    if (result.rows.length === 0) {
      console.log('✅ No tasks with deadline in progress.');
      return;
    }

    function isSameCalendarDay(d1, d2) {
      return d1.getFullYear() === d2.getFullYear() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getDate() === d2.getDate();
    }

    function isExactDateTimeMatch(d1, d2) {
      return d1.getFullYear() === d2.getFullYear() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getDate() === d2.getDate() &&
             d1.getHours() === d2.getHours() &&
             d1.getMinutes() === d2.getMinutes() &&
             d1.getSeconds() === d2.getSeconds();
    }

    for (const row of result.rows) {
      const { maintenance_id, task_name, start_date, end_date, email } = row;

      const start = new Date(start_date);
      const end = new Date(end_date);

      const totalDurationMs = end - start;
      const elapsed80PercentTime = new Date(start.getTime() + totalDurationMs * 0.8);

      if (isSameCalendarDay(start, end)) {
        // Same Day Tasks

        if (currentTime >= elapsed80PercentTime.getTime() && currentTime < end.getTime()) {
          // Level 1 Alert - current time reached 80% of task duration but before end time
          await sendAlert(email, task_name, maintenance_id, end, 'Level 1');

        } else if (isExactDateTimeMatch(currentDate, end)) {
          // Level 2 Alert - current date and time exactly equals end date and time
          await sendAlert(email, task_name, maintenance_id, end, 'Level2');

        } else if (currentTime > end.getTime() + 2 * 24 * 60 * 60 * 1000) {
          // Level 3 Alert - 2+ days after end date time
          await sendAlert(email, task_name, maintenance_id, end, 'Level3');
        }

      } else {
        // Different Day Tasks
        const twoDaysBeforeEnd = new Date(end);
        twoDaysBeforeEnd.setDate(end.getDate() - 2);

        const twoDaysAfterEnd = new Date(end);
        twoDaysAfterEnd.setDate(end.getDate() + 2);

        if (currentDate >= twoDaysBeforeEnd && currentDate < end) {
          // Level 1 Alert - between 2 days before end and before end
          await sendAlert(email, task_name, maintenance_id, end, 'Level 1');

        } else if (isExactDateTimeMatch(currentDate, end)) {
          // Level 2 Alert - exactly at end date and time
          await sendAlert(email, task_name, maintenance_id, end, 'Level2');

        } else if (currentDate > twoDaysAfterEnd) {
          // Level 3 Alert - more than 2 days after end date
          await sendAlert(email, task_name, maintenance_id, end, 'Level3');
        }
      }
    }

  } catch (err) {
    console.error("❌ Error checking upcoming deadlines:", err);
  }
}

async function sendAlert(email, task_name, maintenance_id, endDate, level) {
  const subject = `⚠️ Task "${task_name}" alert - ${level}`;
  const timeDiff = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
  const overdueMsg = level === 'Level 3' ? 'The task is overdue!' : `Deadline is approaching in ${timeDiff} day(s).`;

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

module.exports = checkUpcomingDeadlines;
