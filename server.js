const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const {
	generatePhoneNumber,
	getTempEmail,
	fetchInbox,
	get2FACode,
	getGirlsNames,
} = require("./utils/factory");
const { connectToDatabase } = require("./utils/db");
const jwt = require("jsonwebtoken");
// const bcrypt = require("bcryptjs");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const { startCleanupJob } = require("./utils/guarduser");

const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET;
const saltRounds = 10;

dotenv.config();

app.use(express.json());
app.use(cors());

const limiter = rateLimit({
	windowMs: 60 * 1000,
	max: 60,
	message: {
		status: 429,
		error: "Too many requests, please try again after a minute.",
	},
	standardHeaders: true,
	legacyHeaders: false,
});
app.use(limiter);

// Middleware to authenticate the JWT
const authenticateToken = (req, res, next) => {
	const token = req.headers.authorization?.split(" ")[1]; // Expecting format: "Bearer TOKEN"
	if (!token) {
		return res
			.status(401)
			.json({ access: false, message: "No token provided" });
	}
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.user = decoded; // Add the decoded token data (userId, email) to the request object
		next(); // Continue to the next middleware or route handler
	} catch (error) {
		return res
			.status(403)
			.json({ access: false, message: "Invalid or expired token" });
	}
};

// Start the cleanup job when the server starts
startCleanupJob();

// LET'S START
app.get("/", (req, res) => {
	res.json({ response: "This is a public route accessible to everyone." });
});

// USER VERIFY
app.get("/user_verify", authenticateToken, async (req, res) => {
	try {
		res.status(200).json({ access: true });
	} catch (err) {
		res.status(500).json({ access: false, message: err.message });
	}
});

// GET 2FA CODE
app.get("/get_2fa_code", authenticateToken, async (req, res) => {
	try {
		const { key } = req.query;
		const code = await get2FACode(key);
		res.json(code);
	} catch (err) {
		res
			.status(404)
			.json({ access: false, message: "Something went wrong...!" });
	}
});

// CHECK INBOX
app.get("/check_inbox", authenticateToken, async (req, res) => {
	try {
		const { email } = req.query;
		const inbox = await fetchInbox(email);
		if (inbox) {
			res.json(inbox);
		} else {
			res.status(404).json({ access: true, message: "No emails found." });
		}
	} catch (err) {
		res
			.status(404)
			.json({ access: false, message: "Something went wrong...!" });
	}
});

// GET FACEBOOK INFO
app.get("/get_details", authenticateToken, async (req, res) => {
	try {
		const randomGirlName = await getGirlsNames();
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

// PASSWORD BCRYPT
app.get("/password/bcrypt", async (req, res) => {
	try {
		const { password } = req.query;
		if (!password) {
			return res.status(400).json({ message: "Password query is required" });
		}
		const salt = await bcrypt.genSalt(saltRounds);
		const hashedPassword = await bcrypt.hash(password, salt);

		res.status(200).json({ hashedPassword });
	} catch (error) {
		console.error("Error generating bcrypt password:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// USER LOGIN
app.put("/auth/login", async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) {
			return res
				.status(400)
				.json({ message: "Email and password are required" });
		}
		const db = await connectToDatabase();
		const usersCollection = db.collection("users");

		const user = await usersCollection.findOne({ email });
		if (!user || !(await bcrypt.compare(password, user.hashedPassword))) {
			return res.status(401).json({ message: "Invalid credentials" });
		}
		if (!user.access) {
			return res.status(403).json({
				access: false,
				message:
					"Access denied: same email login on multiple devices not allowed",
			});
		}

		const token = jwt.sign(
			{ userId: user._id, email: user.email },
			process.env.JWT_SECRET,
			{ expiresIn: "30d" },
		);

		await usersCollection.updateOne({ email }, { $set: { access: false } });
		res.status(200).json({ access: true, message: "Login successful", token });
	} catch (error) {
		// Log error and respond with generic error message
		console.error("Error during login:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// USER BLOCK
app.put("/block-user", async (req, res) => {
	try {
		const { email } = req.body;
		if (!email) {
			return res.status(400).json({ message: "Email are required" });
		}
		const db = await connectToDatabase();
		const usersCollection = db.collection("users");

		const exists = await usersCollection.findOne({ email });
		if (!exists)
			return res.status(500).json({ message: "This users already exists" });

		const result = await usersCollection.updateOne(
			{ email },
			{ $set: { access: false } },
			{ unset: true },
		);
		res.status(201).json({
			message: "User updated successfully",
			userId: result.insertedId,
		});
	} catch (error) {
		console.error("Error adding user:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// ADD USER
app.post("/add-user", async (req, res) => {
	try {
		const { email, password, name } = req.body;
		if (!email || !password) {
			return res
				.status(400)
				.json({ message: "Email and password are required" });
		}

		const db = await connectToDatabase();
		const usersCollection = db.collection("users");

		const salt = await bcrypt.genSalt(10);
		const hashedPassword = await bcrypt.hash(password, salt);

		const newUser = {
			name,
			email,
			hashedPassword,
			createdAt: new Date(),
			access: true,
		};
		const exists = await usersCollection.findOne({ email });
		if (exists)
			return res.status(500).json({ message: "This users already exists" });

		const result = await usersCollection.insertOne(newUser);
		res.status(201).json({
			message: "User added successfully",
			userId: result.insertedId,
		});
	} catch (error) {
		console.error("Error adding user:", error);
		res.status(500).json({ message: "Server error" });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
