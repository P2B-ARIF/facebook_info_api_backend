const { MongoClient } = require("mongodb");
const uri = process.env.MONGO_URI; // Set MongoDB URI in your environment variables

let client;

async function connectToDatabase() {
	if (!client) {
		client = new MongoClient(uri, {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		});
		if (!client.isConnected()) await client.connect();
	}
	return client.db("fb_details_creator").collection("users"); // Replace "yourDB" with your DB name
}

// Middleware for IP restriction
const ipRestrictionMiddleware = async (req, res, next) => {
	const clientIP =
		req.headers["x-forwarded-for"] || req.connection.remoteAddress;

	try {
		const collection = await connectToDatabase();
		const allowedIPs = await collection.find({ ip: clientIP }).toArray();

		if (allowedIPs.length === 0) {
			return res.status(403).json({
				access: false,
				message: "Access denied: Your IP is not allowed",
			});
		}
		next();
	} catch (error) {
		console.error("Database error:", error);
		res.status(500).json({ access: false, message: "Internal server error" });
	}
};

// Function to add an IP
const addIP = async (newIP, name) => {
	try {
		const db = await connectToDatabase();
		const userCollection = db.collection("users");
		const existingEntry = await userCollection.findOne({ ip: newIP });

		if (existingEntry) {
			throw new Error("IP already exists");
		}

		const newEntry = {
			ip: newIP,
			createdAt: new Date(),
			name: name,
		};

		await userCollection.insertOne(newEntry);
		return newEntry;
	} catch (error) {
		throw error;
	}
};

// Function to remove an IP
const removeIP = async ipToRemove => {
	try {
		const collection = await connectToDatabase();
		const result = await collection.deleteOne({ ip: ipToRemove });

		if (result.deletedCount === 0) {
			throw new Error("IP not found");
		}
	} catch (error) {
		throw error;
	}
};

// Function to remove expired IPs (older than 30 days)
const removeExpiredIPs = async () => {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

	try {
		const collection = await connectToDatabase();
		await collection.deleteMany({ createdAt: { $lt: thirtyDaysAgo } });
		console.log("Expired IPs cleaned up successfully.");
	} catch (error) {
		console.error("Error cleaning up expired IPs:", error);
	}
};

// Schedule cleanup every day at midnight using node-cron
const cron = require("node-cron");
cron.schedule("0 0 * * *", async () => {
	await removeExpiredIPs();
});

// Export the middleware and functions
module.exports = {
	ipRestrictionMiddleware,
	addIP,
	removeIP,
	removeExpiredIPs,
};
