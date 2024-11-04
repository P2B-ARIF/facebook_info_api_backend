const path = require("path");
const fs = require("fs");
const { default: axios } = require("axios");
const { connectToDatabase } = require("./db");

// Function to read and parse the JSON file
async function getGirlsNames() {
	try {
		// Connect to the database
		const db = await connectToDatabase();
		const girlsCollection = db.collection("girls");

		// Aggregate query to get one random document
		const randomDocs = await girlsCollection
			.aggregate([{ $sample: { size: 1 } }, { $project: { _id: 0 } }])
			.toArray();

		// Check if a document was found
		if (randomDocs.length > 0) {
			return randomDocs[0]; // Return the first random document
		} else {
			// No documents were found
			return { message: "No girls found in the collection." };
		}
	} catch (error) {
		// Log any errors and return a default message
		console.error("Error fetching random girl's name:", error);
		return { error: "Something went wrong fetching the name." };
	}
}

// // Example usage: Get the random name from the JSON file
// async function getRandomName() {
// 	const girlsNames = await getGirlsNames();
// 	if (girlsNames.length > 0) {
// 		const randomIndex = Math.floor(Math.random() * girlsNames.length);
// 		return girlsNames[randomIndex];
// 	}
// 	return null;
// }

// get random robi number
async function generatePhoneNumber() {
	const prefix = "018"; // First three digits
	const randomNumber = Math.floor(10000000 + Math.random() * 90000000); // Generates 8 random digits
	return prefix + randomNumber;
}

// Function to generate random email
async function getTempEmail() {
	// const randomString = Math.random().toString(36).substring(7); // Generate random string
	const randomString = Math.random().toString(36).substring(2, 12);
	const email = `${randomString}@1secmail.com`;
	return email;
}




// Function to get a 2FA code from 2fa.live
async function get2FACode(secret) {
	try {
		const url = `https://2fa.live/tok/${secret}`;
		const response = await axios.get(url);
		return response.data.token; // Get the 2FA token
	} catch (error) {
		console.error("Error fetching 2FA code:", error);
		return null;
	}
}

// // Function to retrieve emails from 1secmail.com API
// async function fetchInbox(email) {
// 	const [username, domain] = email.split("@");
// 	const url = `https://www.1secmail.com/api/v1/?action=getMessages&login=${username}&domain=1secmail.com`;

// 	try {
// 		const response = await axios.get(url);
// 		return response.data;
// 	} catch (error) {
// 		console.error("Error fetching inbox:", error);
// 		return null;
// 	}
// }

module.exports = {
	generatePhoneNumber,
	// getRandomName,
	getGirlsNames,
	getTempEmail,
	get2FACode,
	// fetchInbox,
};
