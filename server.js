//////////////////////////////////////////////////
// SETUP
//////////////////////////////////////////////////
require('dotenv').config();
const express = require('express');
const app = express();
const gtfs = require('gtfs');
const axios = require('axios');
const moment = require('moment-timezone');
const schedule = require('node-schedule');
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

app.listen(port, () => {
	console.log(`Running on port ${port}`);
});
mongoose.connect(config.mongoUrl, {
	useNewUrlParser: true,
	useUnifiedTopology: true
});
db.on('error', err => console.log(err.message));
db.on('connected', () => console.log('Connected to Mongo'));
db.on('disconnected', () => console.log('Disconnected from Mongo'));

//////////////////////////////////////////////////
// IMPORT GTFS DATA
//////////////////////////////////////////////////
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

//////////////////////////////////////////////////
// GET REALTIME INFO
//////////////////////////////////////////////////
let currentData = null;

const updateRealtimeData = () => {
	try {
		axios
			.get(
				`https://mnorth.prod.acquia-sites.com/wse/gtfsrtwebapi/v1/gtfsrt/${process.env.MTA_KEY}/getfeed`
			)
			.then(response => {
				currentData = response.data;
				console.log('Updated realtime data successfully');
			})
			.catch(err => {
				console.log(err);
			});
	} catch (err) {
		console.log(err);
	}
};

// Update realtime data on start and every minute
updateRealtimeData();
setInterval(() => {
	updateRealtimeData();
}, 60 * 1000);

//////////////////////////////////////////////////
// ROUTES
//////////////////////////////////////////////////

// Primary Schedule Route
//
// Requires two parameters, origin_id and destination_id
//
// Steps:
// - Get Service ID from current day
// - Get Trips From Service ID
// - Get Stop Times By Current Stop
// - Filter Stop Times By Trip ID
// - Filter Stop Times By Destination, with destination stop_sequence greater than origin stop_sequence integer
// - Format Data, Pulling In Info From Other Sources As Needed

app.get('/schedule', (req, res) => {
	getServiceIdForToday()
		.then(service_id => getTripsByServiceId(service_id))
		.then(trips =>
			getStopTimesByCurrentStopAndFilter(
				trips,
				req.query.origin_id,
				req.query.destination_id
			)
		)
		.then(trips =>
			formatStopTimes(trips, req.query.origin_id, req.query.destination_id)
		)
		.then(trips => {
			res.json(trips);
		});
});

app.get('/realtime', (req, res) => {
	res.json(currentData);
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

//////////////////////////////////////////////////
// HELPER FUNCTIONS
//////////////////////////////////////////////////

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
				return {
					arrival_time: stopinfo[0].arrival_time,
					arrival_timestamp: stopinfo[0].arrival_timestamp
				};
			})
			.catch(function(err) {
				console.log('error: ', err);
			});
	};

	const getTripInfo = (trip_id, stop_id) => {
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
			})
			.then(allInfo => {
				const delay = getTripDelay(allInfo.trip_short_name, stop_id);
				return { ...allInfo, delay: delay };
			});
	};

	const getTripStops = trip_id => {
		return gtfs.getStoptimes(
			{
				agency_key: 'Metro-North Railroad',
				trip_id: trip_id
			},
			{
				_id: 0,
				departure_time: 1,
				stop_id: 1,
				stop_sequence: 1,
				track: 1,
				departure_timestamp: 1
			}
		);
	};

	const getTripDelay = (trip_short_name, stop_id) => {
		let delay = 0;
		if (currentData != null) {
			currentData.entity.forEach(trip => {
				if (trip.id === trip_short_name) {
					// console.log('Match found for ' + trip_short_name);
					trip.trip_update.stop_time_update.forEach(stop => {
						if (stop.stop_id === stop_id && stop.departure.delay != 0) {
							// console.log(
							// 	`ID ${trip.id}, DELAY AT STOP ${stop_id}, ${stop.departure.delay} SEC`
							// );
							delay = stop.departure.delay;
						}
					});
				}
			});
		}
		return delay;
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
		const trip_info = await getTripInfo(trip.trip_id, trip.stop_id);
		const trip_stops = await getTripStops(trip.trip_id);

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
			peak_offpeak: trip_info.peak_offpeak,
			delay: trip_info.delay,
			trip_stops: trip_stops
		};
	});

	const formattedData = await Promise.all(promises);
	return formattedData;
};
