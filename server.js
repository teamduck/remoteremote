//events = require('events');
//net = require('net');
//nMemcached = require('./3rd-Eden-node-memcached/nMemcached');

http = require('http');
https = require('https');
crypto = require('crypto');
url = require('url');
querystring = require('querystring');
fs = require("fs");
io = require('socket.io');
try {
    gzip = require('gzip');
} catch(e) {
    gzip = undefined;
}

nMemcached = require('memcached');
//Constants = require('Constants');
require('dotenv').config();
Constants = {
    "STATUS_AUTH_SHA1": "0",
}


//constants
STATUS_AUTH_SHA1 = Constants.STATUS_AUTH_SHA1;
DEBUG = true;
DEBUG_TO_FILE = false;
DEBUG_FILE = "out.txt"; //warning, this goes inside the static dir, so it can be served over http
DEBUG_EVENTS = false;
PORT = process.env.PORT || 8080;
CACHE_TYPE = "memcache"; //can be "memcache", "file", or "none". this is where HTTP requests are cached
USE_NONE_MATCH = true; //whether to use the If-None-Match http header
LIMIT_MSGS_PER_SEC = 5;
LIMIT_MAX_BUCKET_SIZE = 10;
//api key is optional, set to undefined if unused
YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
CHANNELS = {
    //lolcats:{title:"not funny", fetch:[{type:"cat", cat:"lolcat"}]},
    //fitness:{title:"just some girl", type:"cat", cat:"fitness"},
    rsa: {title: "learn you an RSA", fetch: [{type: "user", user: "theRSAorg", orderby: "viewCount"}]},
    tasty: {
        title: "tasty network music",
        fetch: [{type: "user", user: "TastyNetwork", orderby: "viewCount", count: 9999}]
    },
    //dubs:{title:"dubstep by tasty", fetch:[{type:"user", user:"TastyDubstepNetwork", orderby:"viewCount", count:9999}]},
    music: {
        title: "some decent", fetch: [
            {type: "user", user: "futuredatarecords", orderby: "viewCount", count: 200},
            {type: "user", user: "UKFDubstep", orderby: "viewCount", count: 200},
            //these two only have like 30 vids each anyway
            {type: "user", user: "DubstepRemixesCom"},
            {type: "user", user: "DubstepMusicUSA"}
        ]
    },

    blackhole: {
        title: "good trance and whatnot",
        fetch: [{type: "user", user: "BlackHoleRecordings", orderby: "viewCount", count: 250}]
    },
    sneaky: {title: "Sneaky Sound System", fetch: [{type: "query", q: "sneaky sound system"}]},
    whoseline: {
        title: "improv ftw",
        fetch: [{type: "query", q: "whose line is it anyway", count: 400}],
        fix_order: true
    },
    alton2: {
        title: "eats that are good",
        fetch: [{type: "query", q: "good eats -LikeTheHat", count: 250}],
        fix_order: true
    },
    alton: {title: "LQ, but rather complete", fetch: [{type: "user", user: "LikeTheHat", count: 250}], fix_order: true},


    freddiew: {title: "freddiew", fetch: [{type: "user", user: "freddiew", orderby: "viewCount"}]},

    cooking: {
        title: "ONLINE COOKING SHOW", fetch: [
            {type: "user", user: "EpicMealTime"},
            {type: "user", user: "SwedishMealTime"}
        ]
    },
    lrr: {title: "LRR", fetch: [{type: "user", user: "loadingreadyrun", count: 999}]},
};
CHANNEL_VIDEOS = 100; //how many videos to load from youtube for each channel, if not defined by the channel
EMOTICONS = {
    smiley: {text: /:\-?\)/, frames: 4, width: 24, height: 24, step_ms: 200},
    tongue: {text: /:\-?P/i, frames: 7, width: 16, height: 13, step_ms: 100},
    //stole this from gmail.. ;_;
    heart: {text: /&lt;3/, frames: 14, width: 13, height: 12, step_ms: 100} //I guess it's html escaped..
};
//events that do not require a user object
ANONYMOUS_EVENTS = {hello: 1, resume_session: 1, get_popular_rooms: 1, ping: 1};
VIDEO_AUTO_NEXT_QUEUE = 2; //play the next vid in the queue after this many seconds
//SLEEP_TIME = 250; //for main loop, in milliseconds (not used anymore)
ROOM_ID_LEN = 5;
ROOM_ID_CHARS = "abcdefghijklmnopqrstuvwxyz";
MAX_ROOMS = 11881370; // ~ 26^5
MAX_MSG_LEN = 160; //just like SMS
MAX_ROOM_TITLE_LEN = 45;
MAX_NAME_LEN = 20;
//POLL_RENEW_TIME = 30; //max time /poll should hang until client renews, in seconds
USER_TIMEOUT_KICK_TIME = 10 * 1000; //if client disconnects for this long, kick them from the system (milliseconds)
HTTP_STATUSES = {
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    404: "Not Found",
    500: "Internal Server Error",
    501: "Not Implemented"
};
HTTP_FETCH_CACHE_TIME = 60 * 60 * 24; //time to cache external HTTP fetches (like youtube data). seconds.
COLORS = ["red", "green", "blue", "purple", "orange"];
BAD_WORDS = ["fuck", "bitch", "ass", "piss", "shit", "cock", "cunt", "tit", "boob"]; //the room names are filtered.
//if any of these are a substring of the room name, it is declared invalid.
//events to buffer and send to the client when they reconnect (local to the client only, stored inside User object)
EVENTS_TO_BUFFER = ["welcome", "join_room_success", "join_room_error",
    "msg", "change_name", "transfer_remote", "user_join",
    "user_leave", "video_info", "room_title_set"];
//events to buffer to display the user when they join the room (local to room, stored in room)
ROOM_EVENTS_TO_BUFFER = ["msg", "change_name", "transfer_remote", "user_join", "user_leave", "video_info", "room_title_set"];
ROOM_EVENTS_BUFFER_LEN = 100;
ROOM_CLIENT_INFO_INTERVAL = 1000; //ms to send out the client info data from the room
SERVER_VERSION_HASH = fs.statSync("server.js").mtime + "|" + fs.statSync("static/client.js").mtime;
SERVER_START_TIME = Date.now();
CACHE_DELETE_FILES_STEP = 50; //ms between deleting expired cache files on init
STATUS_PAGE_MAX_CONSOLE = 10; //max entries for the console input/output on the status page

//vars
var rooms = {}; //index is room_id for O(1) searching
var channel_rooms = {}; //index is the name of the channel
var next_room_num = 0; //room numbers are encoded into their base-26 equivilant, eg: 0 would be aaaaa, 1 = aaaab
var next_sess_id = 1; //may overflow?
//var next_event_id = 1; //may overflow?
var taken_rooms = []; //a simple O(1) search for if a room num has been taken
var debug_fd = null;
var users = {}; //index is client.id from socket.io, value is User object
var users_sess_id = {}; //index is sess_id assigned from this script
//popular rooms memoization
var limit_buckets = {}; //index is client.id, value is an array with indices: val, last_calc
var popular_rooms = {};
var popular_rooms_changed = true; //whether or not the value needs to be re-calculated
var compressed_http_files = {};
var emoticon_id = 1; //each emoticon has an id so referencing is easy-ish

var server_mtime = Date.parse(fs.statSync("server.js").mtime),
    client_mtime = Date.parse(fs.statSync("static/client.js").mtime);
var server_version = new Date(server_mtime > client_mtime ? server_mtime : client_mtime);
// (year-11) . month . day
server_version = (server_version.getFullYear() - 2011) + "." + (server_version.getMonth() + 1) + "." + server_version.getDate();
status_page_console = [];


//classes
//Room: if channel, pass (id,true). else pass (number)
function Room(number, is_channel) {

    this.users = {}; //holds User objects, index is sess id
    //this.events = new Array(); //holds Event objects

    this.is_channel = (is_channel === true);
    if(this.is_channel) {
        this.id = number;
        this.channel_info = CHANNELS[this.id];
        this.title = this.channel_info.title;
        this.video_queue = [];
        this.video_queue_index = 0;
        this.curr_fetch_i = 0; //current index on the fetch param
        this.curr_fetch_num = 0; //current number of videos fetched from this source
        this.channel_ready = false;
        this.channel_next_timeout_id = null;
        this.queue_skipped_videos = 0; //number of videos that arent embeddable
    } else {
        taken_rooms[number] = true;
        this.number = number;
        this.id = room_num2id(number);
        this.title = "";
    }
    this.num_users = 0;
    this.user_with_remote = -1; //sess id of user with the remote
    this.last_event_time = gettime(); //the last time a user has done anything to this room
    this.event_buffer = [];

    //video information
    this.video = null;
    this.video_start_time = 0; //time when video was started since beginning of play, or since it was last paused
    this.video_title = "";
    this.video_duration = -1;
    this.video_prev_elapsed_time = 0; //time the video has played since it was paused
    this.video_paused = false;

    this.client_info_interval_id = setInterval(this.client_info_func, ROOM_CLIENT_INFO_INTERVAL, this);

    if(this.is_channel)
        this.channel_init();
}

Room.prototype.destroy = function () {
    clearInterval(this.client_info_interval_id);
}
Room.prototype.add_user = function (user) {
    debug("adding user " + user.sess_id + " to room " + this.number);
    user.room = this;
    this.users[user.sess_id] = user;
    this.num_users++;
    this.find_color_for(user);

    //send over some old events to spice things up
    for(var i in this.event_buffer) {
        var curr_event = this.event_buffer[i];
        if(curr_event.except == user.sess_id) continue;
        user.send(curr_event.event, curr_event.data);
    }

    this.send("user_join", user.pack());

    if(this.user_with_remote == -1)
        this.give_remote_to(user);
    popular_rooms_changed = true;
}
Room.prototype.remove_user = function (user) {
    if(this.users[user.sess_id] === undefined) return;
    debug("removing user " + user.sess_id + " from room " + this.number);
    delete this.users[user.sess_id];
    this.num_users--;
    user.room = null;

    this.send("user_leave", user.pack());

    if(this.user_with_remote == user.sess_id) {
        //need to find a new remote holder
        if(this.num_users == 0) {
            this.user_with_remote = -1;
        } else {
            //find a random person to give the remote to
            var give_remote_offset = Math.floor(Math.random() * this.num_users);
            for(var i in this.users) {
                if(give_remote_offset-- == 0) {
                    this.give_remote_to(this.users[i]);
                    break;
                }
            }
        }
    }
    popular_rooms_changed = true;
}
Room.prototype.sync = function (user) {
    //make a list of users
    var user_list = {};
    for(var i in this.users) {
        user_list[i] = this.users[i].pack();
    }
    var video_time = this.video_elapsed_time();
    if(video_time === false) video_time = 0;
    user.send("sync", {
        users: user_list, video: this.video, video_time: video_time,
        video_title: this.video_title, paused: this.video_paused,
        room_title: this.title
    });
}
Room.prototype.client_info_func = function (room) {
    if(room.num_users == 0) return;
    var arr = [];
    for(var i in room.users) {
        var user = room.users[i];
        arr.push({user: user.pack(), video_time: user.client_info.video_time});
    }
    room.send("client_info", {info: arr});
}
Room.prototype.send = function (event, data, except) {
    if(event != "client_info" && DEBUG_EVENTS)
        debug("sending room event: " + event);
    for(var i in this.users) {
        var user = this.users[i];
        if(user.sess_id === except) continue;
        user.send(event, data);
    }
    if(ROOM_EVENTS_TO_BUFFER.indexOf(event) != -1) {
        this.event_buffer.push({event: event, data: data, except: except});
        if(this.event_buffer.length > ROOM_EVENTS_BUFFER_LEN)
            this.event_buffer.shift();
    }
}
Room.prototype.find_color_for = function (user) {
    //get least used color from rest of users
    var histo = {};
    for(var i in COLORS) {
        histo[COLORS[i]] = 0;
    }
    for(var user_id in this.users) {
        if(user_id == user.sess_id) continue;
        var color = this.users[user_id].color;
        if(color != null && histo[color] != undefined)
            histo[color]++;
    }
    var least = 999;
    var least_arr = new Array();
    for(var i in histo) {
        if(histo[i] <= least) {
            if(histo[i] != least)
                least_arr = new Array();
            least_arr.push(i);
            least = histo[i];
        }
    }
    //we now have an array, least_arr, that has all the color choices to pick from
    var color = least_arr[Math.floor(Math.random() * least_arr.length)];
    user.color = color;
}
Room.prototype.give_remote_to = function (user) {
    this.user_with_remote = user.sess_id;
    this.send("transfer_remote", user.pack());
}
Room.prototype.set_title = function (title) {
    this.title = title;
    this.send("room_title_set", {title: this.title});
}
//info is an optional param
Room.prototype.set_video = function (video, info) {
    this.send("video_set", {video_id: video});

    this.video = video;
    this.video_start_time = gettime();
    this.video_title = "";
    this.video_duration = -1;
    this.video_prev_elapsed_time = 0;
    this.video_paused = false;

    if(info != undefined) {
        if(this.num_users > 0)
            this.send("video_info", {title: info.title});
        this.video_title = info.title;
        this.video_duration = info.duration;
    } else {
        //fetch the video info
        var this_room = this;
        var host = "www.googleapis.com";
        var path = "/youtube/v3/videos?part=contentDetails,snippet&id=" +
            video +
            "&key=" +
            YOUTUBE_API_KEY;
        http_get(host, path, function (body, status_code) {

            //debug(body);
            var parsed = JSON.parse(body);
            var title = parsed.items[0].snippet.title

            if(title == null) {
                title = "[error fetching title]";
            }
            //find the duration
            var duration = parsed.items[0].contentDetails.duration;
            if(duration == null) {
                duration = -1;
            }
            this_room.send("video_info", {title: title});
            this_room.video_title = title;
            this_room.video_duration = duration;
            popular_rooms_changed = true;
        });
        /*.on('error', function(e) {
         this.send("video_title", {title:"[error fetching title]"});
         });*/
    }

    this.clear_next_timeout();
    if(this.is_channel && isnum(info.duration)) {
        this.channel_next_timeout_id = setTimeout(this.video_next, (info.duration + VIDEO_AUTO_NEXT_QUEUE) * 1000, this); //next vid
    }

    popular_rooms_changed = true;
};

Room.prototype.video_seek = function (seconds, send_event) {
    if(!isdecimal(seconds) || seconds < 0 || seconds > this.video_duration || this.video_duration == -1) return;
    this.video_prev_elapsed_time = seconds;
    this.video_start_time = gettime();
    if(send_event === true) {
        this.send('video_action', {action: "seek", video_time: seconds});
    }
    this.clear_next_timeout();
    if(this.is_channel && isnum(this.video_duration)) {
        this.channel_next_timeout_id = setTimeout(this.video_next, (this.video_duration - seconds + VIDEO_AUTO_NEXT_QUEUE) * 1000, this); //next vid
    }
}
Room.prototype.video_toggle_paused = function () {
    if(this.video_start_time == 0) return; //no video ever played

    this.clear_next_timeout();

    if(this.video_paused) {
        //unpause
        this.video_start_time = gettime();
        //set the next video callback
        if(this.is_channel && isnum(this.video_duration)) {
            this.channel_next_timeout_id = setTimeout(this.video_next, (this.video_duration - this.video_prev_elapsed_time + VIDEO_AUTO_NEXT_QUEUE) * 1000, this); //next vid
        }
    } else {
        //pause
        this.video_prev_elapsed_time += gettime() - this.video_start_time;
    }

    this.video_paused = !this.video_paused;

    //broadcast event
    var action = this.video_paused ? "pause" : "resume";
    this.send('video_action', {action: action, video_time: this.video_elapsed_time()});
}
Room.prototype.video_next = function (room) {
    if(room == undefined) room = this;
    if(room.video_start_time == 0 || !room.channel_ready) return; //no video ever played

    room.clear_next_timeout();

    room.video_queue_index++;
    if(room.video_queue[room.video_queue_index] == undefined) {
        room.video_queue_index = 0;
        room.channel_shuffle(room);
    }
    var item = room.video_queue[room.video_queue_index];
    room.set_video(item.id, item);
}

//returns: false if no video playing, else returns the time in seconds
//this function is needed instead of (currtime - starttime) since pausing may occur
//can return a number greater than video_duration
Room.prototype.video_elapsed_time = function () {
    //if total time is -1 return false (means no video ever started, or video length unknown [error])
    if(this.video_duration == -1) return false;
    var value = this.video_prev_elapsed_time;
    if(!this.video_paused)
        value += gettime() - this.video_start_time;
    return value;
}
//begin loading videos from yuotube to play in a queue
Room.prototype.channel_init = function () {
    //load CHANNEL_VIDEOS videos
    setTimeout(this.channel_get_videos, Math.floor(Math.random() * 5000), this);
}
Room.prototype.channel_get_videos = function (room) {
    //debug(JSON.stringify(room));
    var fetch_data = room.channel_info.fetch[room.curr_fetch_i];
    var vids_to_fetch = (fetch_data.count == undefined ? CHANNEL_VIDEOS : fetch_data.count);
    var start = room.curr_fetch_num + room.queue_skipped_videos + 1,
        max = vids_to_fetch - room.curr_fetch_num;
    if(max <= 0) {
        /*debug("####################### cleanly found all the vids for "+room.title) + */
        if(++room.curr_fetch_i >= room.channel_info.fetch.length) {//so we're at the end for this fetch, are there no more?
            return room.channel_init_finish(room);
        } else {
            room.queue_skipped_videos = 0;
            room.curr_fetch_num = 0;
            return setTimeout(room.channel_get_videos, Math.floor(Math.random() * 500 + 500), room);
        }
    }
    //always send for 50, since some videos dont allow embedding, and it sucks to be searching for 1 over and over..
    max = 50;
    var path = "/";
    if(fetch_data.type == "cat")
        path = "/feeds/api/videos?category=" + fetch_data.cat + "&start-index=" + start + "&max-results=" + max + "&v=2&alt=jsonc&format=5";
    else if(fetch_data.type == "query")
        path = "/feeds/api/videos?q=" + fetch_data.q + "&start-index=" + start + "&max-results=" + max + "&v=2&alt=jsonc&format=5";
    else if(fetch_data.type == "user")
        path = "/feeds/api/users/" + fetch_data.user + "/uploads?start-index=" + start + "&max-results=" + max + "&v=2&alt=jsonc&format=5"
            + (fetch_data.orderby != undefined ? "&orderby=" + fetch_data.orderby : "");
    /*
    http_get(
        "gdata.youtube.com",
        path,
        function (data, code, was_cached) {
            try {
                var arr = JSON.parse(data);
                var items = arr.data.items;
                if(typeof(items) != "object") throw ""; //no results
                //debug("got "+items.length+" items");
                for(var i in items) {
                    var e = items[i];
                    if(typeof(e) != "object") continue;
                    if(e.accessControl.embed == "allowed") {
                        room.video_queue.push({id: e.id, title: e.title, duration: e.duration});
                    } else {
                        this.queue_skipped_videos++; //so we can calc the start-index properly
                    }
                    if(++room.curr_fetch_num >= vids_to_fetch) break;
                }
                setTimeout(room.channel_get_videos, was_cached ? 1 : Math.floor(Math.random() * 500 + 500), room);
            } catch(ex) {
                //debug("####################### uncleanly found all the vids for "+room.title+": "+ex);
                if(++room.curr_fetch_i >= room.channel_info.fetch.length) //so we're at the end for this fetch, are there no more?
                    return room.channel_init_finish(room);
                room.queue_skipped_videos = 0;
                room.curr_fetch_num = 0;
                setTimeout(room.channel_get_videos, was_cached ? 1 : Math.floor(Math.random() * 500 + 500), room);
            }
        });*/
}
Room.prototype.channel_init_finish = function (room) {
    if(room.video_queue.length > 0) {
        room.channel_ready = true;
    } else {
        return;
    }
    room.announce("Fetched " + room.video_queue.length + " videos.");
    room.channel_shuffle(room);


    /*var a = [];
     for(var i in room.video_queue)
     a.push(room.video_queue[i].title);
     room.announce(a.join(", "));*/


    var item = room.video_queue[0];
    room.set_video(item.id, item);
}
Room.prototype.channel_shuffle = function (room) {
    shuffle(room.video_queue);
    if(room.channel_info.fix_order) {
        room.announce("Fixing random sort order..");
        var timer_start = Date.now();
        fix_video_order(room.video_queue);
        var elapsed_ms = (Date.now() - timer_start);
        room.announce("Done (" + elapsed_ms + " ms).");
    }
}
Room.prototype.clear_next_timeout = function () {
    if(this.channel_next_timeout_id != null) {
        clearTimeout(this.channel_next_timeout_id)
        this.channel_next_timeout_id = null;
    }
}
Room.prototype.announce = function (msg) {
    this.send("msg", {sess_id: 0, name: "self", color: "black", msg: msg});
}


function User(client, name) {
    //this.connection = null; //holds a Connection object
    //this.last_ping_time = gettime(); //made of two parts: last time /poll was called, and last time from main() when at least one good connection exists

    this.client = client;
    this.establish_time = gettime();
    this.sess_id = next_sess_id++;
    this.name = name;
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)]; //a random color for now
    this.room = null;
    this.client_info = {video_time: 0};

    this.connected = true;
    this.disconnect_callback_id = null; //the id of the setTimeout used to kick the user after X seconds of not connecting back
    this.buffered_events = [];
}
User.prototype.send = function (event, data) {
    if(event != "client_info" && DEBUG_EVENTS)
        debug("send event: " + event);
    if(this.connected) {
        //this.client.send(payload);
        send_event(this.client, event, data);
    } else {
        if(EVENTS_TO_BUFFER.indexOf(event) != -1)
            this.buffered_events.push({event: event, data: data});
    }
}
User.prototype.pack = function () {
    return {sess_id: this.sess_id, name: this.name, color: this.color};
}


//functions

function debug(str) {
    if(DEBUG) {
        console.log(str);
        if(DEBUG_TO_FILE) {
            if(debug_fd === null)
                debug_fd = fs.openSync("static/" + DEBUG_FILE, "w");
            fs.write(debug_fd, str + "\r\n", null);
        }
    }
}

//returns unix epoch time in seconds
function gettime() {
    //return Math.round(new Date().getTime() / 1000);
    return Math.round(Date.now() / 1000);
}
function sha1(str) {
    return crypto.createHash("sha1").update(str).digest("hex");
}

//returns whether the string given is strictly numeric
function isnum(num) {
    return (/^\d+$/.test(num + ""));
}
//returns whether the string given is strictly numeric or decimal
function isdecimal(num) {
    return (/^\d+(\.\d+)?$/.test(num + ""));
}

function htmlspecialchars(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

//returns whether the string is a valid room ID, but does not check for existance
function is_room_id(str) {
    return (/^[a-z]{5}$/.test(str + ""));
}
//returns whether the string is a valid channel ID, but does not check for existance
function is_channel_id(str) {
    return (/^[a-z0-9]+$/.test(str + ""));
}
//converts a base-10 number into a base-26 string
function room_num2id(num) {
    var str = base(num, ROOM_ID_CHARS);
    while(str.length < ROOM_ID_LEN)
        str = "a" + str;
    return str;
}
//converts a base-26 string into a base-10 number
function room_id2num(str) {
    var num = 0, mul = 1;
    for(var i = str.length - 1; i >= 0; i--) {
        var pos = ROOM_ID_CHARS.indexOf(str.charAt(i));
        if(pos == -1) return null;
        num += pos * mul;
        mul *= ROOM_ID_CHARS.length;
    }
    return num;
}
//taken from: http://snipplr.com/view/139/base-conversion/
// Sample usage for decimal to hex: base(255, '0123456789ABCDEF') == 'FF'
function base(dec, base) {
    var len = base.length;
    var ret = '';
    while(dec > 0) {
        ret = base.charAt(dec % len) + ret;
        dec = Math.floor(dec / len);
    }
    return ret;
}

function send_event(client, event, data) {
    client.json.send({event: event, data: data});
}

function room_id_allowed(name) {
    for(var i in BAD_WORDS) {
        var word = BAD_WORDS[i];
        if(name.indexOf(word) != -1)
            return false;
    }
    return true;
}
function get_next_room_num() {
    //is the next room num available?
    if(next_room_num > MAX_ROOMS)
        next_room_num = 0;

    //okay so like, let's try up to 10 times to find a free random room, so the name is not always aaaaa
    for(var i = 0; i < 10; i++) {
        var random_num = Math.floor(Math.random() * MAX_ROOMS);
        if(taken_rooms[random_num] == undefined && room_id_allowed(room_num2id(random_num)))
            return random_num;
    }

    if(taken_rooms[next_room_num] == undefined && room_id_allowed(room_num2id(next_room_num)))
        return next_room_num++;
    //find next available room
    for(var i = next_room_num; i < MAX_ROOMS; i++) {
        if(taken_rooms[i] == undefined && room_id_allowed(room_num2id(i))) {
            next_room_num = i;
            return next_room_num++;
        }
    }
    //no more free at that side! do a sweep from the left now
    //this should never really happen, also shouldnt work since we arent deleting rooms
    for(var i = 0; i < next_room_num; i++) {
        if(taken_rooms[i] == undefined && room_id_allowed(room_num2id(i))) {
            next_room_num = i;
            return next_room_num++;
        }
    }
    //every room is full! also should never really happen
    debug("every room appears to be full. taken_rooms[10000] = " + taken_rooms[10000]);
    return null;
}

function http_error(response, code, text) {
    try {
        if(code != 304)
            response.writeHead(code, {'Content-Type': 'text/plain'});
        else
            response.writeHead(code);
        var str = HTTP_STATUSES[code];
        if(str === undefined)
            str = "Error";
        if(text != undefined)
            str = text;
        if(code != 304)
            response.write(str);
        response.end();
    } catch(e) {
    }
}

//oops, had to rewrite for node 0.2
//errors will kill node, how to catch? it isn't emitted, nor does a try/catch work
//this function does an HTTP GET request, but uses caches
function http_get(host, path, callback) {
    path = path.replace(/ /g, "%20");
    debug("internal get: " + host + path);
    var cache_key = sha1(host + path) + sha1(path); //I dont know the chance of an sha1 collision

    if(CACHE_TYPE === "memcache") {
        mc.get(cache_key, function (err, result) {
            if(err || result === undefined) return http_get_nocache(host, path, callback, cache_key);
            debug("got data from cache (" + (result + "").length + " bytes)");

            //if((result+"").length < 100) debug(result);
            callback(result, 200, true);
        });
    } else if(CACHE_TYPE === "file") {
        fs.stat("cache/" + cache_key, function (err, stats) {
            if(err) //file doesnt exist
                return http_get_nocache(host, path, callback, cache_key);
            var delta_time = gettime() - Date.parse(stats.mtime) / 1000;
            if(delta_time > HTTP_FETCH_CACHE_TIME) //cache out of date
                return http_get_nocache(host, path, callback, cache_key);
            var data = fs.readFile("cache/" + cache_key, function (err, data) {
                if(err) //some random error
                    return http_get_nocache(host, path, callback, cache_key);
                debug("got data from cache (" + (data + "").length + " bytes)");
                callback(data, 200, true);
            });
        });
    } else {
        http_get_nocache(host, path, callback, cache_key);
    }

}
//cache_key is optional
function http_get_nocache(host, path, callback, cache_key) {
    debug("making external request..");
    var options = {
        host: host,
        //port: 80,
        method: "GET",
        path: path
    };

    try {
        // Since all outbound requests will be using HTTPS, disable HTTP path (at least for now)
        //var request = http.request(options);
        var request = https.request(options);
        request.end();
        request.on('response', function (res) {
            res.setEncoding('utf8');
            var data = "";
            res.on('data', function (chunk) {
                data += chunk;
            });
            res.on('end', function () {
                if(cache_key != undefined && res.statusCode == 200) {
                    if(CACHE_TYPE == "memcache") {
                        mc.set(cache_key, data, HTTP_FETCH_CACHE_TIME);
                    } else if(CACHE_TYPE == "file") {
                        fs.writeFile("cache/" + cache_key, data);
                    }
                }
                callback(data, res.statusCode, false);
            });
        });
    } catch(e) {
        debug("Could not fetch " + host + "/" + path + ": " + e);
        callback("", 404, false);
    }
}

// Array Remove - By John Resig (MIT Licensed)
Array_remove = function (arr, from, to) {
    var rest = arr.slice((to || from) + 1 || arr.length);
    arr.length = from < 0 ? v.length + from : from;
    return arr.push.apply(arr, rest);
};

//shuffles list in-place
//http://dtm.livejournal.com/38725.html
function shuffle(list) {
    var i, j, t;
    for(i = 1; i < list.length; i++) {
        j = Math.floor(Math.random() * (1 + i));
        if(j != i) {
            t = list[i];
            list[i] = list[j];
            list[j] = t;
        }
    }
}


//puts videos like s1e1p1, s1e1p2
function fix_video_order(list) {
    //var last_ep = null, last_part = null;
    var curr_ep, curr_part;
    for(var i = 0; i < list.length; i++) {
        //let's find this current ep str
        var matches = _ep_str_matches(list[i].title);
        if(matches != null) {
            //debug("matched");
            curr_ep = matches[1];
            curr_part = matches[2];
            //look through all the episodes for the next episode, insert it next
            for(var j = 0; j < list.length; j++) {
                if(i == j) continue;
                var item = list[j];
                var matches2 = _ep_str_matches(item.title);
                if(matches2 != null && matches2[1] == curr_ep && matches2[2] - 1 == curr_part) { //subtraction cause string concatination lol
                    //j should go after i
                    //remove j
                    Array_remove(list, j);
                    if(j < i) i--; //'i' has moved back one place since we removed a row before it
                    list.splice(i + 1, 0, item); //insert j at position i+1
                    break;
                }
            }
        }
    }
}
//I'm pretty sure this function doesn't work the way I intended it to.
function _ep_str_matches(str) {
    var matches = str.match(/(s\d+e\d+)p0*(\d+)/i);
    if(matches != null)
        return matches;
    //try to do looser matches
    matches = str.match(/(s(eason)? ?\d+ ?ep? ?\d+)/i);
    if(matches == null) return null;
    //match part x of y and stuff
    var temp = str.match(/(\(| )(part )?0*(\d+)((\/| of )\d+)?/gi);
    if(temp == null || temp.length == 0) return null;
    var last_nums = temp[temp.length - 1];
    if(last_nums == undefined) return null; //? this happened..
    temp = last_nums.match(/0*(\d+)/);
    if(temp == null) return null;
    matches[2] = temp[1];
    return matches;
}


var routes = {};

routes['hello'] = function (client, data) {
    var user = new User(client, "Stranger");
    user.name += user.sess_id;
    users[client.id] = user;
    users_sess_id[user.sess_id] = user;
    user.send("welcome", {
        user: user.pack(),
        server_version_hash: SERVER_VERSION_HASH,
        server_version: server_version,
        start_time: SERVER_START_TIME
    });
}

routes['resume_session'] = function (client, data) {
    var sess_id = data.sess_id;
    if(!isnum(sess_id))
        return send_event(client, 'resume_session_fail') + debug("could not resume non-numeric user id");
    //what user are we talking about here?
    var user = users_sess_id[sess_id];
    if(user == undefined)
        return send_event(client, 'resume_session_fail') + debug("could not find user id to resume");
    if(user.connected)
        return user.send('resume_session_fail') + debug("could not resume, since user still connected");
    //we have enough reason to blindly believe this is the user that disconnected, let them resume
    //copy it over
    debug("resuming session");
    users[client.id] = users[user.client.id];
    delete users[user.client.id];
    user.client = client;
    if(user.disconnect_callback_id !== null) {
        clearTimeout(user.disconnect_callback_id);
        user.disconnect_callback_id = null;
    }
    user.connected = true;
    user.send("resume_session_ok");
    //send back buffered events
    if(user.buffered_events.length > 0) {
        for(var i in user.buffered_events) {
            var event = user.buffered_events[i];
            user.send(event.event, event.data);
        }
        user.buffered_events = [];
    }
    //is the user in a room? sync the data
    if(user.room != null) {
        user.room.sync(user);
    }

}

routes['join_room'] = function (user, data) {
    var room = null, room_id = null;
    if(data.is_channel) {
        //user wants to join a channel
        if(is_channel_id(data.room_id) && channel_rooms[data.room_id] !== undefined /*&& channel_rooms[data.room_id].channel_ready*/) {
            room = channel_rooms[data.room_id];
            room_id = data.room_id;
        } else {
            return user.send("join_room_error");
        }
    } else {
        //user wants to join a normal room
        if(is_room_id(data.room_id)) {
            //user wants to join this room
            //does this room exist?
            room_id = data.room_id;
            if(rooms[room_id] === undefined) {
                //make the room
                var room_num = room_id2num(room_id);
                if(room_num === null)
                    return user.send("join_room_error");
                rooms[room_id] = new Room(room_num);
            }
            room = rooms[room_id];
        } else {
            //user wants a random new room
            var room_num = get_next_room_num();
            if(room_num === null) {
                //no rooms are left...?
                return user.send("join_room_error");
            }

            room_id = room_num2id(room_num);
            room = new Room(room_num);
            rooms[room_id] = room;
        }
    }
    if(user.room != null) {
        user.room.remove_user(user);
    }
    user.send("join_room_success", {room_id: room_id, is_channel: room.is_channel});
    //put the user in the room
    room.add_user(user);
    room.sync(user);
}

routes['leave_room'] = function (user, data) {
    if(user.room === null) return;
    user.room.remove_user(user);
}

routes['msg'] = function (user, data) {
    if(user.room === null) return;
    var room = user.room;

    var msg = data.msg;
    if(msg == undefined || msg.length == 0 || msg.length > MAX_MSG_LEN)
        return user.send("msg_bad");


    //automatically link links
    var msg_html = htmlspecialchars(msg);
    msg_html = msg_html.replace(new RegExp("(#)([a-z]{1," + MAX_NAME_LEN + "})", "g"), '<a href="/$1!$2">$1$2</a>');
    msg_html = msg_html.replace(new RegExp("(#_)([a-z0-9]+)", "g"), '<a href="/$1$2">$1$2</a>');
    msg_html = msg_html.replace(/(http:\/\/[-a-zA-Z0-9@:%_\+\.~#?&\/=]+)/g, '<a href="$1" target="_blank">$1</a>');
    msg_html = msg_html.replace(/ (www.[-a-zA-Z0-9@:%_\+\.~#?&\/=]+)/g, '<a href="http://$1" target="_blank">$1</a>'); //ugh
    //everyone loves emoticons
    var emoticons = [];
    for(var i in EMOTICONS) {
        var e = EMOTICONS[i];
        while(true) {
            var new_msg_html = msg_html.replace(e.text, "<span class=\"emoticon\" id=\"emoticon_" + emoticon_id + "\"></span>");
            if(new_msg_html != msg_html) {
                //a replace took.. place!
                //pack the emoticon data
                emoticons.push({
                    id: emoticon_id,
                    frames: e.frames,
                    width: e.width,
                    height: e.height,
                    step_ms: e.step_ms,
                    image: i + ".png"
                });
                emoticon_id++;
                msg_html = new_msg_html; //kind of important to prevent an infinite loop
            } else {
                break;
            }
        }
    }
    msg_html = msg_html.replace(/\*\*(.+?)\*\*/g, "<i>$1</i>");
    msg_html = msg_html.replace(/\*(.+?)\*/g, "<strong>$1</strong>");
    //if(msg_html.charAt(0)=="*")
    //	msg_html = "<strong>" + msg_html.substring(1) + "</strong>";

    var event_data = user.pack();
    event_data.msg = msg_html;
    event_data.emoticons = emoticons;
    room.send("msg", event_data/*, user.sess_id*/);

    //is this a video?
    var matches = msg.match(/youtube\.com\/watch.*?v=([0-9a-zA-Z_-]{11})/);

    // Also handle https://youtu.be/<id> format
    if(matches === null) {
        matches = msg.match(/youtu\.be\/([0-9a-zA-Z_-]{11})/);
    }

    if(!room.is_channel && matches != null && matches[1] !== undefined) {
        if(room.user_with_remote != user.sess_id)
            user.send("no_remote");
        else
            room.set_video(matches[1]);
    }
};

routes['change_name'] = function (user, data) {
    if(user.room === null) return;
    var room = user.room;

    var name = data.name;
    if(name == undefined || name.length == 0 || name.length > MAX_NAME_LEN)
        return user.send("name_bad");

    if(new RegExp("^\\w{1," + MAX_NAME_LEN + "}$").test(name)) {
        var old_user = user.pack();
        user.name = name;
        var event_data = {old_user: old_user, user: user.pack()};
        room.send("change_name", event_data);
        user.send("name_ok");
    } else {
        user.send("name_bad");
    }
}

routes['give_remote'] = function (user, data) {
    if(user.room === null) return;
    var room = user.room;

    if(room.user_with_remote != user.sess_id)
        return user.send("no_remote");

    if(!isnum(data.to_sess_id) || room.users[data.to_sess_id] == undefined)
        return user.send("invalid_user");

    room.give_remote_to(room.users[data.to_sess_id]);
}

routes['set_room_title'] = function (user, data) {
    if(user.room === null) return;
    var room = user.room;
    if(room.is_channel) return;

    var title = data.title;
    //if(!(/^.{0,100}$/.test(title)))
    if(title == undefined || title.length > MAX_ROOM_TITLE_LEN)
        return user.send("invalid_room_title");

    if(room.user_with_remote != user.sess_id)
        return user.send("no_remote");

    room.set_title(title);
}
/*
 routes['set_video'] = function(user, data) {
 if(user.room === null) return;
 var room = user.room;

 var video = data.video;
 if(!(/^[0-9a-zA-Z_-]+$/.test(video)))
 return user.send("invalid_video");

 if(room.user_with_remote != user.sess_id)
 return user.send("no_remote");

 room.set_video(video);
 }*/

routes['video_action'] = function (user, data) {
    if(user.room === null) return;
    var room = user.room;

    var action = data.action;
    if(action != "toggle_pause" && action != "seek" && action != "next")
        return user.send("protocol_error");
    //next is only for channels
    if(action == "next" && !room.is_channel)
        return user.send("protocol_error");

    if(room.user_with_remote != user.sess_id)
        return user.send("no_remote");

    if(action == "next") {
        room.video_next();
    } else {
        room.video_seek(data.video_time, (action == "seek")); //send only if action is seek
        if(action == "toggle_pause")
            room.video_toggle_paused();
    }
}

routes['client_info'] = function (user, data) {
    if(user.room === null) return;
    var room = user.room;

    var video_time = data.video_time;
    if(isnum(video_time))
        user.client_info.video_time = video_time;
}


routes['get_popular_rooms'] = function (client, data) {
    if(popular_rooms_changed) {
        var arr = [];
        for(var room_id in rooms) {
            var room = rooms[room_id];
            var video_title = "";
            if(room.video != null && room.video_duration != -1) {
                //if current elapsed time < duration
                var elapsed_time = room.video_elapsed_time();
                if(elapsed_time !== false && elapsed_time < room.video_duration)
                    video_title = room.video_title;
            }
            arr.push({id: room_id, num_users: room.num_users, video_title: video_title, title: room.title});
        }
        arr.sort(function (a, b) {
            return b.num_users - a.num_users;
        });
        arr = arr.slice(0, 5);
        popular_rooms = {rooms: arr};
        var arr2 = [];
        for(var i in channel_rooms) {
            var room = channel_rooms[i];
            if(room.channel_ready)
                arr2.push({id: room.id, num_users: room.num_users, video_title: room.video_title, title: room.title});
        }
        popular_rooms.channels = arr2;
    }
    send_event(client, "popular_rooms", popular_rooms);
}

routes['ping'] = function (client, data) {
    send_event(client, "pong");
}

function status_page(request, response, get) {
    if(request.method == "POST") {
        var data = "";
        request.addListener("data", function (chunk) {
            data += chunk;
        });
        request.addListener("end", function () {
            //run the console command
            try {
                data = querystring.parse(data);
            } catch(e) {
                return http_error(response, 400);
            }
            var input = data["input"], auth = data["auth"];
            //auth them
            if(auth !== STATUS_AUTH_SHA1 && sha1(auth) !== STATUS_AUTH_SHA1)
                return http_error(response, 403, "Forbidden - Authentication failed.");
            try {
                var output = eval(input);
            } catch(e) {
                var output = "*error*: " + e;
            }
            try {
                if(typeof(output) == "object")
                    output = JSON.stringify(output, null, '\t');
            } catch(e) {
                output += " " + e;
            }
            status_page_console.push({input: input, output: output});
            if(status_page_console.length > STATUS_PAGE_MAX_CONSOLE) {
                status_page_console.shift();
            }
            response.writeHead(302, {Location: '/status?auth=' + STATUS_AUTH_SHA1});
            response.end();
        });
        return;
    }
    //get the page
    fs.readFile("status_page.html", "utf8", function (err, data) {
        if(err) return http_error(response, 500);
        //generate the dynamic data
        //info
        var info = [];
        info.push("server_version = " + server_version);
        info = info.join("<br>");
        //console
        var console = "";
        for(var i in status_page_console) {
            var e = status_page_console[i];
            console += htmlspecialchars("> " + e.input);
            console += "<br>";
            console += htmlspecialchars("< " + e.output);
            console += "<br><br>";
        }
        var auth = "";
        if(typeof(get) == "object" && get["auth"] == STATUS_AUTH_SHA1)
            auth = STATUS_AUTH_SHA1;
        data = data.replace("{{info}}", info);
        data = data.replace("{{console}}", console);
        data = data.replace("{{auth}}", auth);
        response.writeHead(200, {"Content-Type": "text/html", "Content-Length": data.length});
        response.end(data);

    });
}

var mime_types = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    png: "image/png",
    jpg: "image/jpeg",
    ico: "image/vnd.microsoft.icon",
    txt: "text/plain"
};

function request_handler(request, response) {
    try { //for GET data
        var request_data = url.parse(request.url, true);
    } catch(e) {
        return http_error(response, 400);
    }

    //var data = request_data.query;
    var request_url = request_data.pathname;

    //this request is a static page
    var filename = request_url;
    filename = filename.substring(1);
    if(filename == "status") //reserved for status page
        return status_page(request, response, request_data.query);
    if(filename == "")
        filename = "index.html";
    if(filename.charAt(0) == "." || filename.indexOf(".") == -1 || !filename.match(/^[a-zA-Z0-9\._\-]+$/))
        return debug(request.connection.remoteAddress + " invalid request: " + filename) + http_error(response, 404);
    //what's the file extension
    var i = filename.lastIndexOf(".");
    var content_type = "";
    if(i != -1) {
        var extension = filename.substring(i + 1);
        if(extension != "" && mime_types[extension] != undefined)
            content_type = mime_types[extension];
    }
    fs.stat("static/" + filename, function (err, stats) {
        if(err || !stats.isFile()) {
            debug(request.connection.remoteAddress + " request: '" + request_url + "'");
            debug("Error loading " + filename);
            http_error(response, 404);
        } else {
            var want_gzipped = (gzip != undefined && request.headers['accept-encoding'] != undefined && request.headers['accept-encoding'].indexOf("gzip") != -1);
            fetch_file_compressed("static/" + filename, want_gzipped, function (err, data) {
                if(err) {
                    debug("Error loading2 " + filename);
                    http_error(response, 404);
                } else {
                    var etag = '"' + stats.ino + '-' + stats.size + '-' + Date.parse(stats.mtime) + '"';
                    if(request.headers['if-none-match'] != undefined && request.headers['if-none-match'].indexOf(etag) != -1 && USE_NONE_MATCH)
                        return http_error(response, 304);
                    headers = {
                        "Server": "Sam's amazing nodejs server",
                        "ETag": etag,
                        "Content-Type": content_type,
                        "Content-Length": data.length
                    };
                    if(want_gzipped)
                        headers["Content-Encoding"] = "gzip";
                    response.writeHead(200, headers);
                    response.end(request.method === "HEAD" ? "" : data);
                }
            });
        }
    });
}
//fetches a file from the static dir, compresses it, and returns it (compressed or not).
//caches data to memory, cause memoization is pro
function fetch_file_compressed(filename, want_gzipped, callback) {
    if(compressed_http_files[filename] != undefined)
        return callback(false, compressed_http_files[filename][want_gzipped ? 'gzip' : 'raw']);
    fs.readFile(filename, function (err, data) {
        if(err)
            return callback(true);
        if(gzip == undefined) {
            compressed_http_files[filename] = {gzip: "gzip disabled", raw: data};
            return callback(false, data);
        }
        gzip(data, function (gzip_err, gzip_data) {
            if(gzip_err)
                return callback(true);
            compressed_http_files[filename] = {gzip: gzip_data, raw: data};
            if(want_gzipped)
                callback(false, gzip_data);
            else
                callback(false, data);
        });
    });
}

function socket_io_on_message(client, msg) {
    if(typeof msg != "object" || msg.event == undefined) {
        debug("malformed message, got:");
        debug(JSON.stringify(msg));
        return;
    }
    var data = msg.data;
    if(typeof data != "object") data = {};

    if(routes[msg.event] === undefined) {
        debug("unknown event: " + msg.event);
        return;
    }

    if(msg.event != "client_info" && DEBUG_EVENTS)
        debug("recv event: " + msg.event);

    //are we recving events from this user too fast?
    //update the bucket for this user
    var bucket = limit_buckets[client.id];
    if(bucket == undefined)
        bucket = (limit_buckets[client.id] = {val: LIMIT_MAX_BUCKET_SIZE, last_update: Date.now()});
    var ms_since = Date.now() - bucket.last_update;
    bucket.val += ms_since * LIMIT_MSGS_PER_SEC / 1000;
    if(bucket.val > LIMIT_MAX_BUCKET_SIZE)
        bucket.val = LIMIT_MAX_BUCKET_SIZE;
    bucket.last_update = Date.now();
    //take from the bucket, if possible
    if(bucket.val >= 1) {
        bucket.val--;
    } else {
        //client is rate-limited
        return;
    }

    var user = users[client.id];
    if(ANONYMOUS_EVENTS[msg.event] == 1) {
        //user does not have a User object
        //.....but what if they do.....
        //a single client instantiating multiple user objects, what a horrid idea!
        if(msg.event == "hello" && user != undefined) {
            client.send({event: "protocol_error", data: {msg: "user object already instantiated!"}});
            debug("protocol error: user object already instantiated!");
            return;
        }
        routes[msg.event](client, data);
    } else {
        if(user == undefined) {
            client.send({event: "protocol_error", data: {msg: "no user initialized"}});
            debug("protocol error");
        } else {
            routes[msg.event](user, data);
        }
    }


}

function socket_io_on_disconnect(client) {
    var user = users[client.id];
    if(user === undefined)
        return debug("user does not exist");
    user.connected = false;
    user.disconnect_callback_id = setTimeout(function () {
        if(user.room !== null) {
            debug("user in room " + user.room.id);
            user.room.remove_user(user);
        } else {
            debug("user not in room");
        }
        delete users[client.id];
        delete users_sess_id[user.sess_id];
    }, USER_TIMEOUT_KICK_TIME);
}

function socket_io_handler(client) {
    // new client is here!
    client.on('message', function (msg) {
        socket_io_on_message(client, msg);
    });
    client.on('disconnect', function () {
        socket_io_on_disconnect(client);
    });
}

function remove_old_cache_files() {
    fs.readdir("cache", function (err, files) {
        if(err) return debug("unable to read cache dir");
        remove_cache_file_step(files, 0);
    });
}
function remove_cache_file_step(files, index) {
    if(files[index] == undefined) return;
    fs.stat("cache/" + files[index], function (err, stats) {
        if(!err) {
            var delta_time = gettime() - Date.parse(stats.mtime) / 1000;
            if(delta_time > HTTP_FETCH_CACHE_TIME) { //cache out of date
                fs.unlink("cache/" + files[index]);
            }
        }
        setTimeout(remove_cache_file_step, CACHE_DELETE_FILES_STEP, files, index + 1);
    });
}

//set up some channels
for(var i in CHANNELS) {
    //if(i == "apply_the_author_of_this_module_is_a_moron") continue; //the memcached plugin extends Object's prototype with a method that comes up here
    channel_rooms[i] = new Room(i, true);
}

if(CACHE_TYPE == "memcache") {
    //connect up some memcache
    debug("connecting to memcached");
    mc = new nMemcached("localhost:11211");
}

console.log("Creating HTTP server on port " + PORT + ".");
var server = http.createServer(request_handler);
server.listen(PORT);

console.log("Setting up socket.io.");
var socket = io.listen(server, {flashPolicyServer: true, log: debug});
socket.sockets.on('connection', socket_io_handler);

console.log("Done, ready to connect!");

if(CACHE_TYPE == "file") {
    try {
        var cache_files = fs.readdirSync("cache");
        console.log("init: " + cache_files.length + " files in cache");
    } catch(e) {
    }
}
setTimeout(remove_old_cache_files, 200);
setInterval(remove_old_cache_files, HTTP_FETCH_CACHE_TIME * 1000);
//}
