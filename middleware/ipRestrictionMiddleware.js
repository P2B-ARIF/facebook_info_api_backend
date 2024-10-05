const fs = require("fs");
const path = require("path");
const ip = require("ip");

// Path to the allowedIPs.json file
const ipFilePath = path.join(__dirname, "../allowedIPs.json");

const ipRestrictionMiddleware = (req, res, next) => {
	const clientIP =
		req.headers["x-forwarded-for"] || req.connection.remoteAddress;

	// console.log(`Client IP: ${clientIP}`);

	fs.readFile(ipFilePath, "utf8", (err, data) => {
		if (err) {
			console.error("Error reading allowed IPs file:", err);
			return res
				.status(500)
				.json({ access: false, message: "Internal server error" });
		}

		const allowedIPs = JSON.parse(data);
		if (!allowedIPs.some(entry => entry.ip === clientIP)) {
			return res.status(403).json({
				access: false,
				message: "Access denied: Your IP is not allowed",
			});
		}
		next();
	});
};

// Function to add an IP
const addIP = (newIP, name, callback) => {
	fs.readFile(ipFilePath, "utf8", (err, data) => {
		if (err) return callback(err);

		const allowedIPs = JSON.parse(data);
		const existingEntry = allowedIPs.find(entry => entry.ip === newIP);

		if (existingEntry) {
			return callback(new Error("IP already exists"));
		}

		const newEntry = {
			ip: newIP,
			createdAt: new Date().toISOString(), // Use ISO string format for consistent date storage
			name: name,
		};

		allowedIPs.push(newEntry);

		fs.writeFile(ipFilePath, JSON.stringify(allowedIPs, null, 2), err => {
			if (err) return callback(err);
			callback(null, newEntry);
		});
	});
};

// Function to remove an IP
const removeIP = (ipToRemove, callback) => {
	fs.readFile(ipFilePath, "utf8", (err, data) => {
		if (err) return callback(err);

		let allowedIPs = JSON.parse(data);
		const initialLength = allowedIPs.length;

		allowedIPs = allowedIPs.filter(entry => entry.ip !== ipToRemove);

		if (allowedIPs.length === initialLength) {
			return callback(new Error("IP not found"));
		}

		fs.writeFile(ipFilePath, JSON.stringify(allowedIPs, null, 2), err => {
			if (err) return callback(err);
			callback(null);
		});
	});
};

// Function to clean up expired IPs
const removeExpiredIPs = callback => {
	fs.readFile(ipFilePath, "utf8", (err, data) => {
		if (err) return callback(err);

		let allowedIPs = JSON.parse(data);
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days in milliseconds

		allowedIPs = allowedIPs.filter(
			entry => new Date(entry.createdAt) > thirtyDaysAgo,
		);

		fs.writeFile(ipFilePath, JSON.stringify(allowedIPs, null, 2), err => {
			if (err) return callback(err);
			callback(null);
		});
	});
};

setInterval(() => {
	removeExpiredIPs(err => {
		if (err) console.error("Error cleaning up expired IPs:", err);
	});
}, 60 * 1000);

// Optional: Schedule cleanup to run every day at midnight
const cron = require("node-cron");
cron.schedule("0 0 * * *", () => {
	removeExpiredIPs(err => {
		if (err) console.error("Error cleaning up expired IPs:", err);
		else console.log("Expired IPs cleaned up successfully.");
	});
});

// Export the middleware and functions
module.exports = {
	ipRestrictionMiddleware,
	addIP,
	removeIP,
	removeExpiredIPs,
};
