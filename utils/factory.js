const path = require("path");
const fs = require("fs");
const { default: axios } = require("axios");

// Function to read and parse the JSON file
async function getGirlsNames() {
	const filePath = path.join(__dirname, "./../girls_names.json");
	try {
		const data = fs.readFileSync(filePath, "utf-8"); // Read the JSON file
		const girlsNames = JSON.parse(data); // Parse the JSON string into an object
		return girlsNames;
	} catch (error) {
		console.error("Error reading the file:", error);
		return [];
	}
}

// Example usage: Get the random name from the JSON file
async function getRandomName() {
	const girlsNames = await getGirlsNames();
	if (girlsNames.length > 0) {
		const randomIndex = Math.floor(Math.random() * girlsNames.length);
		return girlsNames[randomIndex];
	}
	return null;
}

// get random robi number
async function generatePhoneNumber() {
	const prefix = "018"; // First three digits
	const randomNumber = Math.floor(10000000 + Math.random() * 90000000); // Generates 8 random digits
	return prefix + randomNumber;
}

// Function to generate random email
async function getTempEmail() {
	const randomString = Math.random().toString(36).substring(7); // Generate random string
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

// Function to retrieve emails from 1secmail.com API
async function fetchInbox(email) {
	const [username, domain] = email.split("@");
	const url = `https://www.1secmail.com/api/v1/?action=getMessages&login=${username}&domain=1secmail.com`;

	try {
		const response = await axios.get(url);
		return response.data;
	} catch (error) {
		console.error("Error fetching inbox:", error);
		return null;
	}
}

module.exports = {
	generatePhoneNumber,
	getRandomName,
	getTempEmail,
	get2FACode,
	fetchInbox,
};
