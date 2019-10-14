// SETUP
require('dotenv').config();
const express = require('express');
const app = express();
const gtfs = require('gtfs');
const config = {
	mongoUrl: 'mongodb://localhost:27017/gtfs',
	agencies: [
		{
			agency_key: 'Metro-North Railroad',
			url: 'http://web.mta.info/developers/data/mnr/google_transit.zip',
			exclude: ['shapes']
		}
	]
};
const port = process.env.EXPRESS_PORT || 3000;
const mongoose = require('mongoose');
const db = mongoose.connection;
const methodOverride = require('method-override');
app.use(methodOverride('_method'));
// app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));

// RUN SERVER / DATABASE
app.listen(port, () => {
	console.log(`Running on port ${port}`);
});
mongoose.connect(config.mongoUrl, { useNewUrlParser: true });
db.on('error', err => console.log(err.message));
db.on('connected', () => console.log('mongo connected'));
db.on('disconnected', () => console.log('mongo disconnected'));

// IMPORT GTFS DATA
// gtfs
// 	.import(config)
// 	.then(() => {
// 		console.log('Import Successful');
// 	})
// 	.catch(err => {
// 		console.error(err);
// 	});

// Get Train Stops
app.get('/stops', (req, res) => {
	// res.json(gtfs.getStops);
	gtfs
		.getStops(
			{
				agency_key: 'Metro-North Railroad'
			},
			{ _id: 0, stop_id: 1, stop_name: 1 }
		)
		.then(stops => {
			res.send(stops);
		});
});
