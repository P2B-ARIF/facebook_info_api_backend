const express = require("express");
const app = express();
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const {
	ipRestrictionMiddleware,
	addIP,
	removeIP,
} = require("./middleware/ipRestrictionMiddleware");
const axios = require("axios");
const cron = require("node-cron");
const cors = require("cors");
const {
	getRandomName,
	generatePhoneNumber,
	getTempEmail,
	fetchInbox,
	get2FACode,
} = require("./utils/factory");

const PORT = process.env.PORT || 5001;
dotenv.config();

app.use(express.json());
app.use(cors());
const ipFilePath = path.join(__dirname, "allowedIPs.json");

app.get("/api/v2/all_ip", ipRestrictionMiddleware, async (req, res) => {
	try {
		fs.readFile(ipFilePath, "utf8", (err, data) => {
			if (err) {
				console.error("Error reading allowed IPs file:", err);
				return res
					.status(500)
					.json({ access: false, message: "Internal server error" });
			}

			const allowedIPs = JSON.parse(data);
			res.status(200).json({ access: true, allowedIPs });
		});
	} catch (err) {
		res
			.status(500)
			.json({ access: false, message: "My not register in server" });
	}
});

app.get("/ip_check", ipRestrictionMiddleware, async (req, res) => {
	try {
		const ip = req.ip;

		fs.readFile(ipFilePath, "utf8", (err, data) => {
			if (err) {
				console.error("Error reading allowed IPs file:", err);
				return res
					.status(500)
					.json({ access: false, message: "Internal server error" });
			}

			const allowedIPs = JSON.parse(data);
			const find = allowedIPs.find(f => f.ip === ip);
			res.status(200).json({ access: true, ip: find.ip, name: find.name });
		});
	} catch (err) {
		res
			.status(500)
			.json({ access: false, message: "My not register in server" });
	}
});

app.get("/get_2fa_code", ipRestrictionMiddleware, async (req, res) => {
	try {
		const { key } = req.query;
		const code = await get2FACode(key);
		res.json(code);
	} catch (err) {
		res.status(404).json("Something went wrong...!");
	}
});

app.get("/check_inbox", ipRestrictionMiddleware, async (req, res) => {
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

app.get("/get_details", ipRestrictionMiddleware, async (req, res) => {
	try {
		const randomGirlName = await getRandomName();
		const randomNumber = await generatePhoneNumber();
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

app.post("/add-ip", (req, res) => {
	const { ip, name } = req.body;
	addIP(ip, name, (err, newEntry) => {
		if (err) return res.status(400).json({ message: err.message });
		res.status(201).json({ message: "IP added successfully", entry: newEntry });
	});
});

app.delete("/remove-ip", (req, res) => {
	const { ip } = req.body;
	removeIP(ip, err => {
		if (err) return res.status(400).json({ message: err.message });
		res.status(200).json({ message: "IP removed successfully" });
	});
});

app.get("/", (req, res) => {
	res.json({ response: "This is a public route accessible to everyone." });
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
