const {Pool} = require('pg');


const pool = new Pool ({
    user: 'sqladmin',  
    host: 'avcpgsqlflexsrvr.postgres.database.azure.com',  
    database: 'MachineryDocumentationSystem_new',  
    password: 'P@$$w0rd123',  
    port: 5432,  
    ssl: false,  
})

module.exports= pool;