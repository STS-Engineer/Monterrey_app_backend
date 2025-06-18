const pool = require('../db');
const scheduleAlertsForTask = require('../services/scheduleAlerts');

async function initTaskAlertScheduler() {
  try {
    const result = await pool.query(`
      SELECT pm.task_name, pm.start_date, pm.end_date, pm.maintenance_id, u.email
      FROM "PreventiveMaintenance" pm
      JOIN "User" u ON pm.assigned_to = u.user_id
      WHERE pm.task_status = 'In progress'
    `);

    result.rows.forEach(scheduleAlertsForTask);

    console.log(`✅ Scheduled alerts for ${result.rows.length} in-progress tasks.`);
  } catch (err) {
    console.error('❌ Failed to initialize task alert scheduler:', err);
  }
}

module.exports = initTaskAlertScheduler;
