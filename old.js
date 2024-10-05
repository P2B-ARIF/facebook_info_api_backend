const express = require("express");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const ipRestrictionMiddleware = require("./middleware/ipRestrictionMiddleware");
const axios = require("axios");
const cors = require("cors");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Function to read and parse the JSON file
function getGirlsNames() {
	const filePath = path.join(__dirname, "girls_names.json");
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
function getRandomName() {
	const girlsNames = getGirlsNames();
	if (girlsNames.length > 0) {
		const randomIndex = Math.floor(Math.random() * girlsNames.length);
		return girlsNames[randomIndex];
	}
	return null;
}

// get random robi number
function generatePhoneNumber() {
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

const ipFilePath = path.join(__dirname, "allowedIPs.json");
// Apply the IP restriction middleware to the protected route
app.use(ipRestrictionMiddleware);
app.use("/protected", ipRestrictionMiddleware);

// Example protected route
app.get("/protected", (req, res) => {
	res.send("Welcome to the protected route!");
});

// get all information
app.get("/get_details", async (req, res) => {
	try {
		console.log("hello");
		const randomGirlName = getRandomName();
		const randomNumber = generatePhoneNumber();
		const tempEmail = await getTempEmail();

		return res.status(200).json({
			girlName: randomGirlName,
			number: randomNumber,
			email: tempEmail,
		});
	} catch (err) {
		res.status(404).json("Something went wrong...!");
	}
});

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

app.get("/check_inbox", async (req, res) => {
	try {
		const { email } = req.query;
		const inbox = await fetchInbox(email);
		if (inbox) {
			res.json(inbox);
		} else {
			res.status(404).json("No emails found.");
		}
	} catch (err) {
		res.status(404).json("Something went wrong...!");
	}
});

app.get("/get_2fa_code", async (req, res) => {
	try {
		const code = await get2FACode(secret);
		res.json(code);
	} catch (err) {
		res.status(404).json("Something went wrong...!");
	}
});








// Route to add a new IP
app.post('/add-ip', (req, res) => {
	const { ip, name } = req.body;
	ipRestrictionMiddleware.addIP(ip, name, (err, newEntry) => {
	  if (err) return res.status(400).json({ message: err.message });
	  res.status(201).json({ message: 'IP added successfully', entry: newEntry });
	});
  });
  
  // Route to remove an IP
  app.delete('/remove-ip', (req, res) => {
	const { ip } = req.body;
	ipRestrictionMiddleware.removeIP(ip, (err) => {
	  if (err) return res.status(400).json({ message: err.message });
	  res.status(200).json({ message: 'IP removed successfully' });
	});
  });















// HOLD ON 

// Route to add an IP address
app.post("/add-ip", (req, res) => {
	const { newIP } = req.body;

	if (!newIP) {
		return res.status(400).json({ message: "Please provide an IP address" });
	}

	fs.readFile(ipFilePath, "utf8", (err, data) => {
		if (err) {
			console.error("Error reading allowed IPs file:", err);
			return res.status(500).json({ message: "Internal server error" });
		}

		const allowedIPs = JSON.parse(data).allowedIPs;

		if (!allowedIPs.includes(newIP)) {
			allowedIPs.push(newIP);

			// Write the updated IP list back to the JSON file
			fs.writeFile(ipFilePath, JSON.stringify({ allowedIPs }), err => {
				if (err) {
					console.error("Error writing allowed IPs file:", err);
					return res.status(500).json({ message: "Internal server error" });
				}

				res.status(200).json({ message: "IP address added successfully" });
			});
		} else {
			res.status(400).json({ message: "IP address already exists" });
		}
	});
});

// Route to remove an IP address
app.delete("/remove-ip", (req, res) => {
	const { removeIP } = req.body;

	if (!removeIP) {
		return res.status(400).json({ message: "Please provide an IP address" });
	}

	fs.readFile(ipFilePath, "utf8", (err, data) => {
		if (err) {
			console.error("Error reading allowed IPs file:", err);
			return res.status(500).json({ message: "Internal server error" });
		}

		let allowedIPs = JSON.parse(data).allowedIPs;

		if (allowedIPs.includes(removeIP)) {
			allowedIPs = allowedIPs.filter(ip => ip !== removeIP);

			// Write the updated IP list back to the JSON file
			fs.writeFile(ipFilePath, JSON.stringify({ allowedIPs }), err => {
				if (err) {
					console.error("Error writing allowed IPs file:", err);
					return res.status(500).json({ message: "Internal server error" });
				}

				res.status(200).json({ message: "IP address removed successfully" });
			});
		} else {
			res.status(400).json({ message: "IP address not found" });
		}
	});
});

// Public route for testing
app.get("/public", (req, res) => {
	res.send("This is a public route accessible to everyone.");
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
