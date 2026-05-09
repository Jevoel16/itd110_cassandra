const cassandra = require('cassandra-driver');

const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1').split(',');
const localDataCenter = process.env.CASSANDRA_DATACENTER || 'datacenter1';
const keyspace = process.env.CASSANDRA_KEYSPACE || 'sdg_goal_6';

const bootstrapClient = new cassandra.Client({
    contactPoints,
    localDataCenter,
});

const client = new cassandra.Client({
    contactPoints,
    localDataCenter,
    keyspace,
});

const connectDB = async () => {
    try {
        await bootstrapClient.connect();
        await bootstrapClient.execute(
            `CREATE KEYSPACE IF NOT EXISTS ${keyspace}
             WITH replication = { 'class': 'SimpleStrategy', 'replication_factor': 1 }`
        );
        await bootstrapClient.shutdown();

        await client.connect();

        // One partition per geolocation, rows ordered by year ascending for efficient regional lookups.
        await client.execute(`
            CREATE TABLE IF NOT EXISTS ${keyspace}.drinking_water_access (
                geolocation text,
                year int,
                access_percentage decimal,
                PRIMARY KEY ((geolocation), year)
            ) WITH CLUSTERING ORDER BY (year ASC)
        `);

        console.log(`Cassandra Connected (keyspace: ${keyspace}) — SDG Goal 6: Water & Sanitation`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = { connectDB, client };
