const { client } = require('../config/db');

const TABLE_NAME = 'drinking_water_access';

const parseCsvLine = (line) => {
	const values = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];

		if (char === '"') {
			inQuotes = !inQuotes;
			continue;
		}

		if (char === ';' && !inQuotes) {
			values.push(current.trim());
			current = '';
			continue;
		}

		current += char;
	}

	values.push(current.trim());
	return values.map((value) => value.replace(/^"|"$/g, '').trim());
};

const normalizeGeolocation = (value) => value.replace(/^\.\./, '').replace(/^\.\.\./, '').trim();

const isMissingValue = (value) => !value || value === '..' || value === '...';

// Parse the semicolon-delimited CSV and bulk-insert into Cassandra
const importDataset = async (req, res) => {
	try {
		const { csv } = req.body;
		if (!csv) {
			return res.status(400).json({ message: 'CSV data is required' });
		}

		const lines = csv.split(/\r?\n/);
		const headerLineIndex = lines.findIndex((line) => line.includes('Geolocation'));

		if (headerLineIndex === -1) {
			return res.status(400).json({ message: 'CSV header row with Geolocation is required' });
		}

		if (lines.length <= headerLineIndex + 1) {
			return res.status(400).json({ message: 'CSV must have a header row and at least one data row' });
		}

		const headerCols = parseCsvLine(lines[headerLineIndex]);
		const years = headerCols.slice(1).map((year) => Number(year)).filter((year) => Number.isFinite(year));

		if (years.length === 0) {
			return res.status(400).json({ message: 'CSV header does not contain valid year columns' });
		}

		let inserted = 0;
		const queries = [];

		for (let i = headerLineIndex + 1; i < lines.length; i += 1) {
			const rawLine = lines[i];
			if (!rawLine || !rawLine.trim()) {
				continue;
			}

			const cols = parseCsvLine(rawLine);
			if (cols.length < 2) {
				continue;
			}

			const geolocation = normalizeGeolocation(cols[0]);
			if (!geolocation) {
				continue;
			}

			for (let j = 0; j < years.length; j += 1) {
				const val = cols[j + 1];
				if (isMissingValue(val)) {
					continue;
				}

				const percentage = parseFloat(val);
				if (isNaN(percentage)) continue;

				queries.push({
					query: `INSERT INTO ${TABLE_NAME} (geolocation, year, access_percentage) VALUES (?, ?, ?)`,
					params: [geolocation, years[j], percentage],
				});
				inserted++;
			}
		}

		// Execute in batches of 30 (Cassandra batch size limit)
		const BATCH_SIZE = 30;
		for (let i = 0; i < queries.length; i += BATCH_SIZE) {
			const batch = queries.slice(i, i + BATCH_SIZE);
			await client.batch(batch, { prepare: true });
		}

		res.json({ message: `Imported ${inserted} data points` });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all geolocations (distinct partition keys)
const getGeolocations = async (req, res) => {
	try {
		const result = await client.execute(`SELECT DISTINCT geolocation FROM ${TABLE_NAME}`);
		const geolocations = result.rows.map((r) => r.geolocation).sort();
		res.json(geolocations);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all data points for a geolocation with pagination
const getByGeolocation = async (req, res) => {
	try {
		const geolocation = normalizeGeolocation(req.params.geolocation.trim());
		const limit = Math.min(parseInt(req.query.limit) || 10, 100);
		const pagingState = req.query.pagingState || null;

		const result = await client.execute(
			`SELECT * FROM ${TABLE_NAME} WHERE geolocation = ?`,
			[geolocation],
			{ prepare: true, fetchSize: limit, pagingState }
		);

		const data = result.rows.map((r) => ({
			geolocation: r.geolocation,
			year: r.year,
			access_percentage: r.access_percentage,
		}));

		res.json({
			data,
			pagingState: result.pageState,
			hasMore: !!result.pageState,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all data points across all geolocations with pagination
const getAllData = async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit) || 10, 100);
		const pagingState = req.query.pagingState || null;

		const result = await client.execute(
			`SELECT * FROM ${TABLE_NAME}`,
			[],
			{ prepare: true, fetchSize: limit, pagingState }
		);

		const data = result.rows.map((r) => ({
			geolocation: r.geolocation,
			year: r.year,
			access_percentage: r.access_percentage,
		}));

		res.json({
			data,
			pagingState: result.pageState,
			hasMore: !!result.pageState,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get a single data point
const getOne = async (req, res) => {
	try {
		const { geolocation, year } = req.params;
		const result = await client.execute(
			`SELECT * FROM ${TABLE_NAME} WHERE geolocation = ? AND year = ?`,
			[normalizeGeolocation(geolocation.trim()), parseInt(year, 10)],
			{ prepare: true }
		);
		if (result.rowLength === 0) {
			return res.status(404).json({ message: 'Data point not found' });
		}
		const r = result.rows[0];
		res.json({ geolocation: r.geolocation, year: r.year, access_percentage: r.access_percentage });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Create a new data point
const createOne = async (req, res) => {
	try {
		const { geolocation, year, access_percentage } = req.body;
		if (!geolocation || year == null || access_percentage == null) {
			return res.status(400).json({ message: 'Geolocation, year, and access_percentage are required' });
		}

		await client.execute(
			`INSERT INTO ${TABLE_NAME} (geolocation, year, access_percentage) VALUES (?, ?, ?)`,
			[normalizeGeolocation(geolocation.trim()), parseInt(year, 10), parseFloat(access_percentage)],
			{ prepare: true }
		);

		res.status(201).json({
			geolocation: normalizeGeolocation(geolocation.trim()),
			year: parseInt(year, 10),
			access_percentage: parseFloat(access_percentage),
		});
	} catch (error) {
		res.status(400).json({ message: error.message });
	}
};

// Update an existing data point
const updateOne = async (req, res) => {
	try {
		const { geolocation, year } = req.params;
		const { access_percentage } = req.body;

		if (access_percentage == null) {
			return res.status(400).json({ message: 'Access percentage is required' });
		}

		const existing = await client.execute(
			`SELECT * FROM ${TABLE_NAME} WHERE geolocation = ? AND year = ?`,
			[normalizeGeolocation(geolocation.trim()), parseInt(year, 10)],
			{ prepare: true }
		);
		if (existing.rowLength === 0) {
			return res.status(404).json({ message: 'Data point not found' });
		}

		await client.execute(
			`UPDATE ${TABLE_NAME} SET access_percentage = ? WHERE geolocation = ? AND year = ?`,
			[parseFloat(access_percentage), normalizeGeolocation(geolocation.trim()), parseInt(year, 10)],
			{ prepare: true }
		);

		res.json({
			geolocation: normalizeGeolocation(geolocation.trim()),
			year: parseInt(year, 10),
			access_percentage: parseFloat(access_percentage),
		});
	} catch (error) {
		res.status(400).json({ message: error.message });
	}
};

// Delete a data point
const deleteOne = async (req, res) => {
	try {
		const { geolocation, year } = req.params;

		const existing = await client.execute(
			`SELECT * FROM ${TABLE_NAME} WHERE geolocation = ? AND year = ?`,
			[normalizeGeolocation(geolocation.trim()), parseInt(year, 10)],
			{ prepare: true }
		);
		if (existing.rowLength === 0) {
			return res.status(404).json({ message: 'Data point not found' });
		}

		await client.execute(
			`DELETE FROM ${TABLE_NAME} WHERE geolocation = ? AND year = ?`,
			[normalizeGeolocation(geolocation.trim()), parseInt(year, 10)],
			{ prepare: true }
		);

		res.json({ message: 'Deleted successfully' });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

module.exports = { importDataset, getGeolocations, getByGeolocation, getAllData, getOne, createOne, updateOne, deleteOne };