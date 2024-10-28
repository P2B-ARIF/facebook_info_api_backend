const { connectToDatabase } = require("./db");

const removeExpiredIPs = async () => {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

	try {
		const db = await connectToDatabase();
		const usersCollection = db.collection("users");
		
		// Update documents where `createdAt` is older than 30 days to set `membership` to false
		const result = await usersCollection.updateMany(
			{ createdAt: { $lt: thirtyDaysAgo } },
			{ $set: { membership: false } }
		);
		
	
		console.log(
			`Updated ${result.modifiedCount} records.`
		);
	} catch (error) {
		console.error("Error cleaning up expired IPs:", error);
	}
};

// Set up the cleanup job to run every minute
const startCleanupJob = () => {
	console.log("Membership updating...");

	// Run the cleanup job every 60 seconds (1 minute)
	setInterval(() => {
		removeExpiredIPs();
	}, 60 * 1000); // 60 seconds * 1000 milliseconds
};

// Export the cleanup job function
module.exports = { startCleanupJob };
