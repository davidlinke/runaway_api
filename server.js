// SETUP
require('dotenv').config();
const express = require('express');
const app = express();
const gtfs = require('gtfs');
var moment = require('moment-timezone');
var schedule = require('node-schedule');
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
app.use(express.urlencoded({ extended: false }));

// RUN SERVER / DATABASE
app.listen(port, () => {
	console.log(`Running on port ${port}`);
});
mongoose.connect(config.mongoUrl, { useNewUrlParser: true });
db.on('error', err => console.log(err.message));
db.on('connected', () => console.log('mongo connected'));
db.on('disconnected', () => console.log('mongo disconnected'));

// Import GTFS Data
const updateGTFSdata = () => {
	gtfs
		.import(config)
		.then(() => {
			console.log('Imported GTFS data successfully');
		})
		.catch(err => {
			console.error(err);
		});
};

// Set Up GTFS Data Import on a recurring schedule (configured to be daily at 1:30am)
const gtfsImportSchedule = schedule.scheduleJob(
	{ hour: 1, minute: 30 },
	function() {
		console.log('Updating GTFS data...');
		updateGTFSdata();
	}
);

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
	const currentDate = moment(date)
		.tz('America/New_York')
		.format('YYYYMMDD');
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
	const currentTime = moment(time)
		.tz('America/New_York')
		.format('HH:mm:ss');
	const offsetTime = moment(time)
		.tz('America/New_York')
		.add(60, 'm')
		.format('HH:mm:ss');
	gtfs
		.getStoptimes({
			agency_key: 'Metro-North Railroad',
			stop_id: req.params.stop_id,
			departure_time: {
				$gt: currentTime,
				$lt: offsetTime
			}
		})
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

/*
- Get Service ID from current day
- Get Trips From Service ID
- Get Stop Times By Current Stop
- Filter Stop Times By Trip ID
- Filter Stop Times By Destination, with destination stop_sequence greater than origin stop_sequence integer
*/

app.get('/schedule/:stop_id/:destination_id', (req, res) => {
	getServiceIdForToday()
		.then(service_id => getTripsByServiceId(service_id))
		.then(trips =>
			getStopTimesByCurrentStopAndFilter(
				trips,
				req.params.stop_id,
				req.params.destination_id
			)
		)
		.then(trips =>
			formatStopTimes(trips, req.params.stop_id, req.params.destination_id)
		)
		.then(trips => {
			res.json(trips);
		});
});

const getServiceIdForToday = () => {
	const today = moment(new Date())
		.tz('America/New_York')
		.format('YYYYMMDD');
	return gtfs
		.getCalendarDates({
			date: today
		})
		.then(data => {
			return data[0].service_id;
		});
};

const getTripsByServiceId = service_id => {
	return gtfs.getTrips({
		agency_key: 'Metro-North Railroad',
		service_id: service_id
	});
};

const getStopTimesByCurrentStopAndFilter = (trips, stop_id, destination_id) => {
	// Get Stop Times From Origin Stop
	return (
		gtfs
			.getStoptimes({
				agency_key: 'Metro-North Railroad',
				stop_id: stop_id
			})
			// Filter Stop Times To Only Include Trips For Current Day
			.then(data => {
				const filteredData = data.filter(stop => {
					return trips.some(e => e.trip_id === stop.trip_id);
				});
				return filteredData;
			})
			// Filter Stop Times To Only Include Trips To Destination
			.then(data => {
				return gtfs
					.getStoptimes({
						agency_key: 'Metro-North Railroad',
						stop_id: destination_id
					})
					.then(destination_data => {
						const filteredData = data.filter(stop => {
							return destination_data.some(
								e =>
									e.trip_id === stop.trip_id &&
									e.stop_sequence > stop.stop_sequence
							);
						});
						filteredData.sort(
							(a, b) => a.arrival_timestamp - b.arrival_timestamp
						);
						return filteredData;
					});
			})
	);
};

const formatStopTimes = async (data, stop_id, destination_id) => {
	const getTripStopTime = trip => {
		return gtfs
			.getStoptimes({
				agency_key: 'Metro-North Railroad',
				trip_id: trip.trip_id,
				stop_id: destination_id
			})
			.then(stopinfo => {
				// console.log(stopinfo[0].arrival_time);
				return {
					arrival_time: stopinfo[0].arrival_time,
					arrival_timestamp: stopinfo[0].arrival_timestamp
				};
			});
	};

	const getTripInfo = trip_id => {
		let info = {};
		return gtfs
			.getTrips({
				agency_key: 'Metro-North Railroad',
				trip_id: trip_id
			})
			.then(tripInfo => {
				info = tripInfo[0];
				return tripInfo[0];
			})
			.then(tripInfo => {
				return gtfs.getRoutes({
					agency_key: 'Metro-North Railroad',
					route_id: tripInfo.route_id
				});
			})
			.then(routeInfo => {
				return { ...info, ...routeInfo[0] };
			});
	};

	const calculateDuration = (start_time, end_time) => {
		if (start_time < end_time) {
			return end_time - start_time;
		} else {
			return start_time - end_time;
		}
	};

	const promises = data.map(async trip => {
		const stop_times = await getTripStopTime(trip);
		const trip_info = await getTripInfo(trip.trip_id);
		return {
			trip_id: trip.trip_id,
			trip_headsign: trip_info.trip_headsign,
			trip_short_name: trip_info.trip_short_name,
			route_id: trip_info.route_id,
			route: trip_info.route_long_name,
			route_color: trip_info.route_color,
			route_text_color: trip_info.route_text_color,
			origin_id: trip.stop_id,
			destination_id: destination_id,
			departure_time: trip.departure_time,
			departure_timestamp: trip.departure_timestamp,
			arrival_time: stop_times.arrival_time,
			arrival_timestamp: stop_times.arrival_timestamp,
			trip_duration: calculateDuration(
				trip.departure_timestamp,
				stop_times.arrival_timestamp
			),
			stop_sequence: trip.stop_sequence,
			wheelchair_accessible: trip_info.wheelchair_accessible,
			peak_offpeak: trip_info.peak_offpeak
		};
	});

	const formattedData = await Promise.all(promises);
	return formattedData;
};
