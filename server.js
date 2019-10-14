// SETUP
require('dotenv').config();
const express = require('express');
const app = express();
const gtfs = require('gtfs');
var moment = require('moment');
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

// IMPORT GTFS DATA, can probably run once a day or week
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

// Get Service ID For today
app.get('/serviceid', (req, res) => {
	const date = new Date();
	const currentDate = moment(date).format('YYYYMMDD');
	gtfs
		.getCalendarDates({
			date: currentDate
		})
		.then(calendars => {
			res.send(calendars);
		});
});

app.get('/stoptimes/:stop_id', (req, res) => {
	const time = new Date();
	const currentTime = moment(time).format('HH:mm:ss');
	const offsetTime = moment(time)
		.add(60, 'm')
		.format('HH:mm:ss');
	gtfs
		.getStoptimes(
			{
				agency_key: 'Metro-North Railroad',
				stop_id: req.params.stop_id,
				departure_time: {
					$gt: currentTime,
					$lt: offsetTime
				}
			}
			// {
			// 	sort: { departure_time: 1 }
			// }
		)
		.then(stoptimes => {
			res.send(stoptimes);
		});
});

app.get('/trip/:trip_id', (req, res) => {
	gtfs
		.getTrips({
			agency_key: 'Metro-North Railroad',
			trip_id: req.params.trip_id
		})
		.then(trips => {
			res.send(trips);
		});
});

app.get('/tripsbyserviceid/:service_id', (req, res) => {
	gtfs
		.getTrips({
			agency_key: 'Metro-North Railroad',
			service_id: req.params.service_id
		})
		.then(trips => {
			res.send(trips);
		});
});

app.get('/tripstops/:trip_id', (req, res) => {
	gtfs
		.getStoptimes({
			agency_key: 'Metro-North Railroad',
			trip_id: req.params.trip_id
		})
		.then(stoptimes => {
			res.send(stoptimes);
		});
});

app.get('/routes/:route_id', (req, res) => {
	gtfs
		.getRoutes({
			agency_key: 'Metro-North Railroad',
			route_id: req.params.route_id
		})
		.then(routes => {
			res.send(routes);
		});
});
