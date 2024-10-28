const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const {
	generatePhoneNumber,
	getTempEmail,
	fetchInbox,
	get2FACode,
	getGirlsNames,
} = require("./utils/factory");
const { connectToDatabase } = require("./utils/db");
const { startCleanupJob } = require("./utils/guarduser");
const fns = require("date-fns");

dotenv.config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET;
const saltRounds = 10;

// Middleware
app.use(express.json());
app.use(cors());

// Rate limiter (60 requests per minute)
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

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
	const token = req.headers.authorization?.split(" ")[1];
	if (!token) {
		return res
			.status(401)
			.json({ access: false, message: "No token provided" });
	}
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.user = decoded;
		next();
	} catch (error) {
		return res
			.status(403)
			.json({ access: false, message: "Invalid or expired token" });
	}
};

// Start the cleanup job when the server starts
startCleanupJob();

// Public Route
app.get("/", (req, res) => {
	res.json({ response: "This is a public route accessible to everyone." });
});

// Verify User Route
app.get("/user_verify", authenticateToken, async (req, res) => {
	res.status(200).json({ access: true });
});

// Get 2FA Code Route
app.get("/get_2fa_code", authenticateToken, async (req, res) => {
	try {
		const { key } = req.query;
		const code = await get2FACode(key);
		res.json(code);
	} catch (err) {
		res.status(500).json({ access: false, message: "Something went wrong!" });
	}
});

// Check Inbox Route
app.get("/check_inbox", authenticateToken, async (req, res) => {
	try {
		const { email } = req.query;

		// console.log(email, "email");
		const inbox = await fetchInbox(email);
		if (!inbox || inbox.length === 0) {
			return res
				.status(255)
				.json({ access: true, message: "No emails found." });
		}
		res.json(inbox);
	} catch (err) {
		res.status(500).json({ access: false, message: "Something went wrong!" });
	}
});

// Get Random Details Route
app.get("/get_details", authenticateToken, async (req, res) => {
	try {
		const randomGirlName = await getGirlsNames();
		const randomNumber = await generatePhoneNumber();
		const tempEmail = await getTempEmail();

		res.status(200).json({
			girlName: randomGirlName,
			number: randomNumber,
			email: tempEmail,
		});
	} catch (err) {
		res.status(500).json({ message: "Something went wrong!" });
	}
});

// Password Hashing Route
app.get("/password/bcrypt", async (req, res) => {
	try {
		const { password } = req.query;
		if (!password) {
			return res.status(400).json({ message: "Password query is required" });
		}
		const hashedPassword = await bcrypt.hash(password, saltRounds);
		res.status(200).json({ hashedPassword });
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
});

// User Login Route
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
			JWT_SECRET,
			{ expiresIn: "30d" },
		);

		await usersCollection.updateOne({ email }, { $set: { access: false } });
		res.status(200).json({ access: true, message: "Login successful", token });
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
});

// Block User Route
app.put("/block-user", async (req, res) => {
	try {
		const { email } = req.body;
		if (!email) {
			return res.status(400).json({ message: "Email is required" });
		}
		const db = await connectToDatabase();
		const usersCollection = db.collection("users");

		const user = await usersCollection.findOne({ email });
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		await usersCollection.updateOne({ email }, { $set: { access: false } });
		res.status(200).json({ message: "User blocked successfully" });
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
});

// Add User Route
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

		const existingUser = await usersCollection.findOne({ email });
		if (existingUser) {
			return res.status(400).json({ message: "User already exists" });
		}

		const hashedPassword = await bcrypt.hash(password, saltRounds);

		const newUser = {
			name,
			email,
			hashedPassword,
			createdAt: new Date(),
			access: true,
		};

		const result = await usersCollection.insertOne(newUser);
		res
			.status(201)
			.json({ message: "User added successfully", userId: result.insertedId });
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
});

app.get("/api/today",authenticateToken,  async (req, res) => {
	try {
		const { email } = req.user;
		const db = await connectToDatabase();
		const currentDate = new Date();

		// const email = "arif3@gmail.com";
		const yearMonth = fns.format(currentDate, "yyyyMM");
		const fbBulkCollection = db.collection(yearMonth);

		const formattedDate = fns.format(currentDate, "MM/dd/yyyy");

		const result = await fbBulkCollection
			.aggregate([
				{ $match: { date: formattedDate } },
				{ $unwind: "$bulkId" },
				{ $match: { "bulkId.userEmail": email } },
			])
			.toArray();

		res.status(200).send({today: result.length});
	} catch (err) {
		res.status(500).send({ message: err.message });
	}
});

// History and Report Table
app.get("/api/table", authenticateToken, async (req, res) => {
	try {
		const { email } = req.user;
		const db = await connectToDatabase();
		const currentDate = new Date();
		const startDate = new Date();
		startDate.setDate(currentDate.getDate() - 4); // Last 3 days

		const yearMonth = fns.format(currentDate, "yyyyMM");
		const fbBulkCollection = db.collection(yearMonth);

		// Aggregation for all data (total counts)
		const allData = await fbBulkCollection
			.aggregate([
				{
					$match: {
						date: {
							$gte: fns.format(startDate, "MM/dd/yyyy"),
							$lte: fns.format(currentDate, "MM/dd/yyyy"),
						},
						"bulkId.userEmail": email,
					},
				},
				{ $unwind: "$bulkId" },
				{
					$match: {
						"bulkId.userEmail": email,
					},
				},
				{
					$group: {
						_id: { date: "$date", mode: "$bulkId.mode" },
						count: { $sum: 1 },
					},
				},
				{
					$group: {
						_id: "$_id.date",
						modes: {
							$push: {
								mode: "$_id.mode",
								count: "$count",
							},
						},
					},
				},
				{
					$project: {
						date: "$_id",
						modes: 1,
						_id: 0,
					},
				},
			])
			.toArray();

		// Aggregation for approved data
		const approvedData = await fbBulkCollection
			.aggregate([
				{
					$match: {
						date: {
							$gte: fns.format(startDate, "MM/dd/yyyy"),
							$lte: fns.format(currentDate, "MM/dd/yyyy"),
						},
						"bulkId.userEmail": email,
					},
				},
				{ $unwind: "$bulkId" },
				{
					$match: {
						"bulkId.userEmail": email,
						"bulkId.approved": true,
					},
				},
				{
					$group: {
						_id: { date: "$date", mode: "$bulkId.mode" },
						count: { $sum: 1 },
					},
				},
				{
					$group: {
						_id: "$_id.date",
						modes: {
							$push: {
								mode: "$_id.mode",
								count: "$count",
							},
						},
					},
				},
				{
					$project: {
						date: "$_id",
						modes: 1,
						_id: 0,
					},
				},
			])
			.toArray();

		// Combining both datasets into a single result
		const combinedResults = allData.map(item => {
			const approvedItem = approvedData.find(
				data => data.date === item.date,
			) || { modes: [] };
			const completeCount =
				item.modes.find(m => m.mode === "complete")?.count || 0;
			const quickCount = item.modes.find(m => m.mode === "quick")?.count || 0;
			const approvedCompleteCount =
				approvedItem.modes.find(m => m.mode === "complete")?.count || 0;
			const approvedQuickCount =
				approvedItem.modes.find(m => m.mode === "quick")?.count || 0;

			return {
				date: item.date,
				complete: completeCount,
				quick: quickCount,
				approvedComplete: approvedCompleteCount,
				approvedQuick: approvedQuickCount,
			};
		});

		// Include any dates present in approvedData but missing in allData
		const allDates = new Set(combinedResults.map(item => item.date));
		approvedData.forEach(approvedItem => {
			if (!allDates.has(approvedItem.date)) {
				const approvedCompleteCount =
					approvedItem.modes.find(m => m.mode === "complete")?.count || 0;
				const approvedQuickCount =
					approvedItem.modes.find(m => m.mode === "quick")?.count || 0;

				combinedResults.push({
					date: approvedItem.date,
					complete: 0,
					quick: 0,
					approvedComplete: approvedCompleteCount,
					approvedQuick: approvedQuickCount,
				});
			}
		});

		// Sort results by date
		combinedResults.sort((a, b) => new Date(a.date) - new Date(b.date));

		res.status(200).json(combinedResults);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error" });
	}
});

// Mail Complete Route
app.put("/mail/complete", authenticateToken, async (req, res) => {
	try {
		const body = req.body;
		const { mail, pass, uid, twoFA, mode } = body;
		const user = req.user;

		// console.log(body, "user");

		if (!mail || !pass || !uid || !twoFA) {
			return res.status(400).json({ message: "Full Data are required" });
		}

		const date = fns.format(new Date(), "MM/dd/yyyy");
		const yearMonth = fns.format(new Date(), "yyyyMM");

		const db = await connectToDatabase();
		const fbBulkCollection = db.collection(yearMonth);

		const find = await fbBulkCollection.findOne({ date: date });
		if (find) {
			const result = await fbBulkCollection.updateOne(
				{ date: date },
				{
					$push: {
						bulkId: {
							...body,
							gender: "female",
							country: "BD",
							userEmail: user.email,
							createdAt: new Date(),
						},
					},
				},
			);

			return res.status(200).json(result);
		} else {
			const result = await fbBulkCollection.insertOne({
				date: date,
				bulkId: [
					{
						...body,
						gender: "female",
						country: "BD",
						userEmail: user.email,
						createdAt: new Date(),
					},
				],
			});

			return res.status(201).json(result);
		}
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
