const express = require('express');
const pool = require('../db');

module.exports = function(io, connectedUsers) {
  const router = express.Router();

  router.get('/executor/:executorId', async (req, res) => {
    const { executorId } = req.params;

    try {
  const result = await pool.query(
  `SELECT pm.*, 
          mtr.feedback, 
          mtr.response 
   FROM "PreventiveMaintenance" pm
   LEFT JOIN "Maintenance_task_reviews" mtr 
     ON pm.maintenance_id = mtr.maintenance_id
   WHERE pm.assigned_to = $1 
     AND pm.task_status IN ('Pending Review','Accepted','Rejected', 'Completed')
   ORDER BY pm.start_date DESC`,
  [executorId]
);


      res.json(result.rows);

      // Optional: notify executor their inbox was fetched
      const socketId = connectedUsers[executorId];
      if (socketId) {
        io.to(socketId).emit('inboxFetched', {
          message: 'Inbox tasks fetched',
          tasks: result.rows,
        });
      }

    } catch (err) {
      console.error('Error fetching executor inbox:', err);
      res.status(500).json({ message: 'Error fetching executor inbox' });
    }
  });

  return router;
};
