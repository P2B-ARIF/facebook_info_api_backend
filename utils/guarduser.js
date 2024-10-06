const { connectToDatabase } = require("./db");

// Function to remove expired IPs (older than 30 days)
const removeExpiredIPs = async () => {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

	try {
		const db = await connectToDatabase();
		const usersCollection = db.collection("users");
		const result = await usersCollection.deleteMany({
			createdAt: { $lt: thirtyDaysAgo },
		});
		console.log(
			`Expired IPs cleaned up successfully. Deleted ${result.deletedCount} records.`,
		);
	} catch (error) {
		console.error("Error cleaning up expired IPs:", error);
	}
};

// Set up the cleanup job to run every minute
const startCleanupJob = () => {
	console.log("Starting the IP cleanup job, running every minute...");

	// Run the cleanup job every 60 seconds (1 minute)
	setInterval(() => {
		removeExpiredIPs();
	}, 60 * 1000); // 60 seconds * 1000 milliseconds
};

// Export the cleanup job function
module.exports = { startCleanupJob };
