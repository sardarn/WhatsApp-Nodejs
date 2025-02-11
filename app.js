require('events').EventEmitter.defaultMaxListeners = 200000;
const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const axios = require('axios');
const port = process.env.PORT || 443;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
var rimraf = require("rimraf");

app.use(express.json());
app.use(express.urlencoded({
	extended: true
}));

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const setSessionsFile = function(sessions) {
	fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
		if (err) {
			console.log(err);
		}
	});
}
    
const getSessionsFile = function() {
	return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}


//const { Client } = require('whatsapp-web.js');
//var qrcode2 = require('qrcode-terminal');

const createSession = function(id, description,reAuth) {
	console.log('Creating session: ' + id);
	const SESSION_FILE_PATH = `./whatsapp-session-${id}`;
	
	
	if (!fs.existsSync(SESSION_FILE_PATH)){
		fs.mkdirSync(SESSION_FILE_PATH);
	}

	const client = new Client({
		restartOnAuthFail: false,
		puppeteer: {
			executablePath: '/usr/bin/google-chrome-stable',
			headless: true,
			userDataDir: SESSION_FILE_PATH,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-accelerated-2d-canvas',
				'--no-first-run',
				'--no-zygote',
				'--single-process', // <- this one doesn't works in Windows
				'--disable-gpu'
			],
		},
	});

	client.initialize();

	client.on('message', msg => {
		axios.post("https://abjosh.ir/cp/read.php", {
			id: id,
			from: msg.from,
			body: msg.body,
		}).then(function(response) {
			console.log("rec ok")
		}).catch(function(error) {
			console.log(error)
		});
	});

	client.on('qr', (qr) => {
		//console.log('QR RECEIVED', qr);
		console.log('QR RECEIVED');
		qrcode.toDataURL(qr, (err, url) => {
			io.emit('qr', { id: id, src: url });
			io.emit('message', { id: id, text: 'QR Code received, scan please!' });
			
			axios.post("https://abjosh.ir/cp/qr.php", {
				id: id,
				qr: url,
			}).then(function(response) {
				console.log("qr ok")
			}).catch(function(error) {
				console.log(error)
			});
			
		});
		//qrcode2.generate(qr, {small: true});
	});

	client.on('ready', () => {
		io.emit('ready', { id: id });
		io.emit('message', { id: id, text: 'Whatsapp is ready!' });
		console.error("ready");
		axios.post("https://abjosh.ir/cp/ready.php", {
			id: id,
		}).then(function(response) {
			console.log("ready ok")
		}).catch(function(error) {
			console.log(error)
		});
		
	});

	client.on('authenticated', () => {
		io.emit('authenticated', { id: id });
		io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
		console.error("authenticated");
	});

	client.on('auth_failure', function() {
		const SESSION_FILE_PATH = `./whatsapp-session-${id}`;
		io.emit('message', { id: id, text: 'Auth failure, Retry...' });
		client.destroy();
		axios.post("https://abjosh.ir/cp/error.php", {
			id: id,
			error: 'auth_failure',
		}).then(function(response) {
			console.log(response.data)
		}).catch(function(error) {
			console.log('auth_failure error')
		});
		
		
		rimraf.sync(SESSION_FILE_PATH);
	});

	client.on('disconnected', (reason) => {
		const SESSION_FILE_PATH = `./whatsapp-session-${id}`;
		io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
		client.destroy();
		axios.post("https://abjosh.ir/cp/error.php", {
			id: id,
			error: 'disconnected',
		}).then(function(response) {
			console.log(response.data)
		}).catch(function(error) {
			console.log('disconnected error')
		});
		
		rimraf.sync(SESSION_FILE_PATH);
	});

	
	sessions.push({
		id: id,
		description: description,
		reAuth: reAuth,
		client: client
	});

	const savedSessions = getSessionsFile();
	
}

const init = function(socket) {
	const savedSessions = getSessionsFile();

	if (savedSessions.length > 0) {
		if (socket) {
			socket.emit('init', savedSessions);
		} else {
			savedSessions.forEach(sess => {
				createSession(sess.id, sess.description,'0');
			});
		}
	}
}

init();

// Socket IO
io.on('connection', function(socket) {
	init(socket);

	socket.on('create-session', function(data) {
		console.log('Create session: ' + data.id);
		createSession(data.id, data.description, data.reAuth);
	});
});

// Send message
app.post('/send-message', (req, res) => {

	const sender = req.body.sender;
	const number = phoneNumberFormatter(req.body.number);
	const message = req.body.message;
	const fileUrl = req.body.file;
	let mimetype;
	let imageStr;
	const client = sessions.find(sess => sess.id == sender).client;
	var request = require('request').defaults({ encoding: null });

	if(message == "" && fileUrl == ""){
		res.status(200).json({
			status: false
		});
	}

	client.isRegisteredUser(number).then(response => {

		if(response == true){

			if(message != ""){

				client.sendMessage(number, message).then(response => {
					res.status(200).json({
						status: true,
						response: response
					});
				}).catch(err => {
					res.status(500).json({
						status: false,
						response: err
					});
				});

			}
			if(fileUrl != ""){
				
				request.get(fileUrl, function (error, responsee, body) {
					if (!error && responsee.statusCode == 200) {
						mimetype = responsee.headers["content-type"];

						console.log('mime: '+ mimetype);
						imageStr = Buffer.from(body).toString('base64');
						data = "data:" + responsee.headers["content-type"] + ";base64," + Buffer.from(body).toString('base64');

						const media = new MessageMedia(mimetype, imageStr, 'Media');
						console.log('mime: '+ mimetype);
						client.sendMessage(number, media, {
							caption: ''
						}).then(response => {
							console.log('ok: '+ response);
							res.status(200).json({
								status: true,
								response: response
							});
						}).catch(err => {
							console.log('error: '+ err);
							res.status(500).json({
								status: false,
								response: err
							});
						});

						//console.log(data);
					}else{
						res.status(500).json({
							status: false,
							response: error
						});
						console.log('Error Download File');
					}
				});
			}

		}else{
			res.status(200).json({
				status: false,
				response: 'NotRegistered'
			});
		}
	}).catch(err => {
		res.status(500).json({
			status: false,
			response: err
		});
	});
});


app.post('/is-registered', (req, res) => {

	const sender = req.body.sender;
	const number = phoneNumberFormatter(req.body.number);
	const client = sessions.find(sess => sess.id == sender).client;


	client.isRegisteredUser(number).then(response => {
		res.status(200).json({
			status: true,
			response: response
		});
	}).catch(err => {
		res.status(500).json({
			status: false,
			response: err
		});
	});
	
});

app.post('/profile-picture', (req, res) => {

	const sender = req.body.sender;
	const number = phoneNumberFormatter(req.body.number);
	const client = sessions.find(sess => sess.id == sender).client;


	client.getProfilePicUrl(number).then(response => {
		res.status(200).json({
			status: true,
			response: response
		});
		console.log(response);
	}).catch(err => {
		res.status(500).json({
			status: false,
			response: err
		});
	});
	
});



app.post('/get-chats', (req, res) => {
	const sender = req.body.sender;
	

	const client = sessions.find(sess => sess.id == sender).client;
	
	client.getChats().then(response => {
		res.status(200).json({
			status: true,
			response: response
		});
	}).catch(err => {
		res.status(500).json({
			status: false,
			response: err
		});
	});
	
});

app.post('/qr', (req, res) => {

	const sender = req.body.sender;

	console.log('Create session: ' + sender);
		createSession(sender, "", false);

	res.status(200).json({
		status: true,
		response: "please wait"
	});
	
});

app.post('/close', (req, res) => {

	const sender = req.body.sender;
	const SESSION_FILE_PATH = `./whatsapp-session-${sender}`;
	
	if (fs.existsSync(SESSION_FILE_PATH))
	{
		try {
			const client = sessions.find(sess => sess.id == sender).client;
			
			client.logout().then(response => {
				console.log("logout");
				res.status(200).json({
					status: true,
					response: "closed"
				});
			}).catch(err => {
				client.destroy().then(response => {
					console.log(response);
					console.log("destroy");
					rimraf.sync(SESSION_FILE_PATH);
					

					res.status(200).json({
						status: true,
						response: "closed"
					});
				}).catch(err => {
					rimraf.sync(SESSION_FILE_PATH);
					console.log("destroy error");
					res.status(200).json({
						status: false,
						response: "try again"
					});
				});
				console.log("logout error");
				
			});
			
		}
		catch (e) {
			rimraf.sync(SESSION_FILE_PATH);
			  res.status(200).json({
				status: true,
				response: "number is not ready"
			});
		}
	}else{
		res.status(200).json({
			status: false,
			response: "number is not valid"
		});
	}

});

server.listen(port, function() {
	console.log('App running on *: ' + port);
});

