const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const {
	generatePhoneNumber,
	getTempEmail,
	get2FACode,
	getGirlsNames,
} = require("./utils/factory");
const { connectToDatabase } = require("./utils/db");
const { startCleanupJob } = require("./utils/guarduser");
const fns = require("date-fns");
const xlsx = require("xlsx");
const { Readable } = require("stream");

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
	windowMs: 5 * 1000,
	max: 100,
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
	const { email } = req.user;

	try {
		const db = await connectToDatabase();
		const usersCollection = await db.collection("users");
		const user = await usersCollection.findOne({ email });
		if (user.membership) {
			return res.status(200).json({ membership: user.membership });
		} else {
			return res.status(200).json({
				membership: false,
				message:
					"Your membership has expired. Please renew to continue enjoying full access.",
			});
		}
	} catch (err) {
		res.status(500).json({ access: false, message: err.message });
	}
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
				.status(401)
				.json({ message: "Email and password are required" });
		}
		const db = await connectToDatabase();
		const usersCollection = await db.collection("users");

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
		if (user && !user.membership) {
			return res
				.status(200)
				.json({ membership: false, message: "Membership expired.." });
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

// approved
app.put("/api/approved/:yearMonth/:date", async (req, res) => {
	const { date, yearMonth } = req.params;

	const emails = req.body; // Expecting an array of emails
	const formattedDate = fns.format(new Date(date), "MM/dd/yyyy");

	try {
		const db = await connectToDatabase();
		// const yearMonth = fns.format(new Date(), "yyyyMM");
		const fbBulkCollection = await db.collection(yearMonth);

		// Update the approved field for the specified emails
		const result = await fbBulkCollection.updateMany(
			{
				date: formattedDate,
				"bulkId.mail": { $in: emails }, // Match documents containing bulkId with specified emails
			},
			{
				$set: { "bulkId.$[mailElement].approved": true }, // Set approved to true for matched elements
			},
			{
				arrayFilters: [{ "mailElement.mail": { $in: emails } }], // Filter elements within bulkId array
			},
		);

		// Return the count of modified documents
		res.status(200).send({ modifiedCount: result.modifiedCount });
	} catch (err) {
		console.error("Error updating approved status:", err);
		res.status(500).json({ message: "Server error" });
	}
});

// excel file download
app.get("/api/download/:yearMonth/:date", async (req, res) => {
	const { date, yearMonth } = req.params;

	const finder = fns.format(new Date(date), "MM/dd/yyyy");

	try {
		const db = await connectToDatabase();
		// const yearMonth = fns.format(new Date(), "yyyyMM");
		const fbBulkCollection = await db.collection(yearMonth);

		const data = await fbBulkCollection
			.aggregate([{ $match: { date: finder } }, { $unwind: "$bulkId" }])
			.toArray();

		const excelData = data.map(entry => ({
			Email: entry.bulkId.mail || "",
			UID: entry.bulkId.uid || "",
			Password: entry.bulkId.pass || "",
			TwoFA: entry.bulkId.twoFA || "",
			UserEmail: entry.bulkId.userEmail || "",
		}));

		const workbook = xlsx.utils.book_new();
		const worksheet = xlsx.utils.json_to_sheet(excelData);
		xlsx.utils.book_append_sheet(workbook, worksheet, "Data");

		const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
		const stream = new Readable();
		stream.push(buffer);
		stream.push(null);

		res.setHeader(
			"Content-Disposition",
			`attachment; filename="today_data_${date.replace(/\//g, "_")}.xlsx"`,
		);
		res.setHeader(
			"Content-Type",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);

		stream.pipe(res);
	} catch (error) {
		console.error("Error generating Excel file:", error);
		res.status(500).send({ message: "Error generating Excel file." });
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
		const usersCollection = await db.collection("users");

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

app.put("/to-active", async (req, res) => {
	try {
		const { email } = req.body;
		if (!email) {
			return res.status(400).json({ message: "Email is required" });
		}
		const db = await connectToDatabase();
		const usersCollection = await db.collection("users");

		const user = await usersCollection.findOne({ email });
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		await usersCollection.updateOne({ email }, { $set: { access: true } });
		res.status(200).json({ message: "User Active successfully" });
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
		const usersCollection = await db.collection("users");

		const existingUser = await usersCollection.findOne({ email });
		if (existingUser) {
			return res
				.status(400)
				.json({ success: false, message: "User already exists" });
		}

		const hashedPassword = await bcrypt.hash(password, saltRounds);

		const newUser = {
			name,
			email,
			hashedPassword,
			createdAt: new Date(),
			access: true,
			membership: true,
		};

		const result = await usersCollection.insertOne(newUser);
		res.status(201).json({
			message: "User added successfully",
			userId: result.insertedId,
			success: true,
		});
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
});

app.get("/api/today", authenticateToken, async (req, res) => {
	try {
		const { email } = req.user;
		const db = await connectToDatabase();
		const currentDate = new Date();

		// const email = "arif3@gmail.com";
		const yearMonth = fns.format(currentDate, "yyyyMM");
		const fbBulkCollection = await db.collection(yearMonth);

		const formattedDate = fns.format(currentDate, "MM/dd/yyyy");

		const result = await fbBulkCollection
			.aggregate([
				{ $match: { date: formattedDate } },
				{ $unwind: "$bulkId" },
				{ $match: { "bulkId.userEmail": email } },
			])
			.toArray();

		const instagramCollection = await db.collection("instagram");
		const date = fns.format(new Date(), "MM/dd/yyyy");
		const instaResult = await instagramCollection
			.find({
				$and: [{ userEmail: email }, { "createdAt.date_fns": { $eq: date } }],
			})
			.toArray();

		res
			.status(200)
			.send({ facebook: result.length, instagram: instaResult.length });
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
		startDate.setDate(currentDate.getDate() - 7); // Last 3 days

		const yearMonth = fns.format(currentDate, "yyyyMM");
		const fbBulkCollection = await db.collection(yearMonth);

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
		const fbBulkCollection = await db.collection(yearMonth);

		// Check if `twoFA` or `mail` already exists for the given `date`
		const existingEntry = await fbBulkCollection.findOne({
			date: date,
			bulkId: {
				$elemMatch: {
					$or: [{ twoFA: twoFA }, { mail: mail }],
				},
			},
		});

		if (existingEntry) {
			return res.status(409).json({
				message: "Either twoFA or mail already exists for this date",
			});
		}

		const documentForDate = await fbBulkCollection.findOne({ date: date });
		if (documentForDate) {
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

app.post("/mail/insta2fa", authenticateToken, async (req, res) => {
	try {
		const body = req.body;
		const { mail, pass, username, twoFA, mode } = body;
		const user = req.user;

		// console.log(body, "body");

		if (!mail || !pass || !username || !twoFA) {
			return res.status(400).json({ message: "Full Data are required" });
		}

		const db = await connectToDatabase();
		const instagramCollection = await db.collection("instagram");

		// 	const d = new Date()
		// const da = d.setDate(d.getDate() - 2);

		const date = fns.format(new Date(), "MM/dd/yyyy");

		const result = await instagramCollection.insertOne({
			...body,
			userEmail: user.email,
			createdAt: { date: new Date(), date_fns: date },
		});

		return res.status(201).json(result);
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
});

app.get("/api/instagram/table", authenticateToken, async (req, res) => {
	try {
		// const email = "1@gmail.com"; // Replace with req.user.email if needed
		const { email } = req.user;
		// console.log(email, "email");

		const db = await connectToDatabase();
		const currentDate = new Date();
		const startDate = new Date();
		startDate.setDate(currentDate.getDate() - 7); // Last 30 days (or customize)

		// Format start and current date for comparison
		const formattedStartDate = fns.format(startDate, "MM/dd/yyyy");
		const formattedCurrentDate = fns.format(currentDate, "MM/dd/yyyy");

		const instagramCollection = await db.collection("instagram");

		// Aggregation to count both approved entries and total entries per day
		const approvalHistory = await instagramCollection
			.aggregate([
				{
					$match: {
						"createdAt.date_fns": {
							$gte: formattedStartDate,
							$lte: formattedCurrentDate,
						},
						userEmail: email,
					},
				},
				{
					$group: {
						_id: "$createdAt.date_fns", // Group by date
						totalCount: { $sum: 1 }, // Count total records for the day
						approvedCount: {
							$sum: { $cond: [{ $eq: ["$approved", true] }, 1, 0] }, // Count only approved entries
						},
					},
				},
				{
					$project: {
						date: "$_id", // Date field
						totalCount: 1, // Total record count for the day
						approvedCount: 1,
						_id: 0, // Exclude the MongoDB ID
					},
				},
			])
			.toArray();

		// console.log(approvalHistory, "approval history");

		// Sort the results by date (ascending order)
		approvalHistory.sort((a, b) => new Date(a.date) - new Date(b.date));

		res.status(200).json(approvalHistory); // Return the history table with total and approved counts
	} catch (error) {
		console.error("Error fetching Instagram approval history:", error);
		res.status(500).json({ message: "Server error. Please try again later." });
	}
});

app.put("/api/instagram/approved/:date", async (req, res) => {
	const { date } = req.params;

	const emails = req.body; // Expecting an array of emails
	const formattedDate = fns.format(new Date(date), "MM/dd/yyyy");

	try {
		const db = await connectToDatabase();
		const instagramCollection = await db.collection("instagram");

		// Update the approved field for the specified emails
		const result = await instagramCollection.updateMany(
			{
				"createdAt.date_fns": formattedDate, // Match the date in the 'createdAt.date_fns' field
				mail: { $in: emails }, // Match documents where the email is in the provided array
			},
			{
				$set: { approved: true }, // Set approved to true for matched documents
			},
		);
		// Return the count of modified documents
		res.status(200).send({ modifiedCount: result.modifiedCount });
	} catch (err) {
		console.error("Error updating approved status:", err);
		res.status(500).json({ message: "Server error" });
	}
});

app.delete("/api/instagram/delete/:date", async (req, res) => {
	const { date } = req.params;
	const emails = req.body; // Expecting an array of emails
	const formattedDate = fns.format(new Date(date), "MM/dd/yyyy");

	try {
		const db = await connectToDatabase();
		const instagramCollection = await db.collection("instagram");

		// Delete the specified documents for the emails and date
		const result = await instagramCollection.deleteMany({
			"createdAt.date_fns": formattedDate, // Match the date in the 'createdAt.date_fns' field
			mail: { $in: emails }, // Match documents where the email is in the provided array
		});

		// Return the count of deleted documents
		res.status(200).send({ deletedCount: result.deletedCount });
	} catch (err) {
		console.error("Error deleting Instagram records:", err);
		res.status(500).json({ message: "Server error" });
	}
});

app.get("/api/insta2fa/download/:date", async (req, res) => {
	const { date } = req.params;
	const finder = fns.format(new Date(date), "MM/dd/yyyy");

	try {
		const db = await connectToDatabase();
		const instagramCollection = await db.collection("instagram");

		// Query the database for records matching the formatted date
		const data = await instagramCollection
			.find({ "createdAt.date_fns": finder }) // Correct query format
			.toArray();

		// Map the data to a format suitable for Excel export
		const excelData = data.map(entry => ({
			Email: entry.mail || "",
			Username: entry.username || "",
			Password: entry.pass || "",
			TwoFA: entry.twoFA || "",
			UserEmail: entry.userEmail || "",
		}));

		// Create a new workbook and add the data as a sheet
		const workbook = xlsx.utils.book_new();
		const worksheet = xlsx.utils.json_to_sheet(excelData);
		xlsx.utils.book_append_sheet(workbook, worksheet, "Data");

		// Convert the workbook to a buffer
		const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

		// Create a readable stream from the buffer
		const stream = Readable.from(buffer);

		// Set the headers to prompt a download in the browser
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="insta2fa_data_${date.replace(/\//g, "_")}.xlsx"`,
		);
		res.setHeader(
			"Content-Type",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);

		// Pipe the buffer stream to the response
		stream.pipe(res);
	} catch (error) {
		console.error("Error generating Excel file:", error);
		res.status(500).send({ message: "Error generating Excel file." });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
