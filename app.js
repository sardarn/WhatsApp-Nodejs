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
const qrcode2 = require('qrcode-terminal');


app.use(express.json());
app.use(express.urlencoded({
	extended: true
}));

app.get('/', (req, res) => {
	res.sendFile('index.html', {
		root: __dirname
	});
});

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

const createSession = function(id, description,reAuth) {
	console.log('Creating session: ' + id);
	const SESSION_FILE_PATH = `./whatsapp-session-${id}`;
	
	if (!fs.existsSync(SESSION_FILE_PATH)){
		fs.mkdirSync(SESSION_FILE_PATH);
	}

	const client = new Client({
		restartOnAuthFail: false,
		puppeteer: {
			//executablePath:  'C:/Program Files/Google/Chrome/Application/chrome.exe',
			//executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
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
		//console.log(msg);

		/*if (msg.body == '1') {
			msg.reply("Hello");
		}else{*/
			axios.post("https://xxxxx.ir/rec.php", {
				from: msg.from,
				body: msg.body,
			}).then(function(response) {
				console.log(response.data)

				//if(response.data != "ok")
					//msg.reply(response.data);

			}).catch(function(error) {
				console.log(error)
			});
		//}
	});

	client.on('qr', (qr) => {
		console.log('QR RECEIVED', qr);
		qrcode.toDataURL(qr, (err, url) => {
			io.emit('qr', { id: id, src: url });
			io.emit('message', { id: id, text: 'QR Code received, scan please!' });
		});
		qrcode2.generate(qr, {small: true});
		axios.post("https://xxxxx.ir/qr.php", {
			id: msg.id,
			src: msg.url,
		}).then(function(response) {
			console.log(response.data)
		}).catch(function(error) {
			console.log(error)
		});
	});

	client.on('ready', () => {
		io.emit('ready', { id: id });
		io.emit('message', { id: id, text: 'Whatsapp is ready!' });
		console.error("ready");
	});

	client.on('authenticated', (session) => {
		io.emit('authenticated', { id: id });
		io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
		console.error("authenticated");
	});

	client.on('auth_failure', function(session) {
		io.emit('message', { id: id, text: 'Auth failure, Retry...' });
		client.destroy();
	});

	client.on('disconnected', (reason) => {
		io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
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

	const action = req.body.action;
	const sender = req.body.sender;
	const number = phoneNumberFormatter(req.body.number);
	const message = req.body.message;
	const fileUrl = req.body.file;
	let mimetype;
	let imageStr;
	const client = sessions.find(sess => sess.id == sender).client;
	var request = require('request').defaults({ encoding: null });



	if(message == '' && fileUrl == ''){
		res.status(200).json({
			status: false
		});
	}

	client.isRegisteredUser(number).then(response => {

		if(response == true){

			if(message != ''){

				client.sendMessage(number, message).then(response => {
					res.status(200).json({
						status: true,
						response: response
					});
				}).catch(err => {
					res.status(501).json({
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
	var request = require('request').defaults({ encoding: null });


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
	var request = require('request').defaults({ encoding: null });


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
	var request = require('request').defaults({ encoding: null });


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


app.post('/get-chat', (req, res) => {

	const sender = req.body.sender;
	const chatId = phoneNumberFormatter(req.body.id);

	const client = sessions.find(sess => sess.id == sender).PrivateChat;

	client.fetchMessages(chatId).then(response => {
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
			response: "wait"
		});
	

});

server.listen(port, function() {
	console.log('App running on *: ' + port);
});
