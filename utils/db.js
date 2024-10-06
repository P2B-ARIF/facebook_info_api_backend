const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");
dotenv.config();

const uri = process.env.MONGO_URI;
let client;
let db;

const connectToDatabase = async () => {
	try {
		// If the database is already initialized, return it
		if (db) return db;

		// Initialize and connect the MongoDB client if it's not already connected
		if (!client) {
			client = new MongoClient(uri, {
				useNewUrlParser: true,
				useUnifiedTopology: true,
			});
			await client.connect();
			console.log("Connected to MongoDB");
		}

		// Get the database and cache it for future calls
		db = client.db("fb_details_creator");
		return db;
	} catch (error) {
		console.error("Error connecting to MongoDB:", error);
		throw new Error("Database connection failed");
	}
};

module.exports = { connectToDatabase };
