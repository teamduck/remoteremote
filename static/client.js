//
// Remote Remote now with socket.io
// 12/31/2010
//

ROOM_ID_LEN = 5;
CHAT_SIZE_LIMIT = 160;
MAX_NAME_LEN = 20;
MAX_ROOM_TITLE_LEN = 45;
CLIENT_INFO_INTERVAL = 1000; //how often to send the client info, like video time
DEFAULT_TITLE = "remoteremote";
ALERT_TITLE = "ALERT! New Message!";
var popular_room_gen_data = [
    {data: "rooms", title: "Popular", id: "!", none: "No rooms loaded.", display_prefix: "", show_title: false},
    {data: "channels", title: "Channels", id: "_", none: "No channels loaded.", display_prefix: "_", show_title: true}
];

var socket;

var yourName;
var yourSession;
var yourRoom;
var yourRemote = false;
var remoteSessId;
var room_title = "";
var video_title = "";
var room_history = []; //each index is an object with keys: id
var is_channel;
var server_version_hash, server_version, server_start_time; //server info
var disconnect = false;
var ping_time; //set to Date.now(); on ping()
//for doing the tab title alert
var window_focused = true;
var alert_message = false;
var alert_message_interval, alert_message_i;
var popular_rooms_cache, last_popular_room_html, loaded_emoticons = {};
var _player_put_timeout;
var player_quality = "default", player_quality_set = false;
var last_transport_attempted = "<unknown>";

var users = {}; //key is session id, value is User object (sess_id, name, color array)
var user_list = {}; //key is session id, value is true

var get_popular_rooms_interval_id;

//debugging values
var debug_io = false;
function debug(data) {
    if(typeof(console) == "object" && console.log != undefined)
        console.log(data);
}

//logging
function connection_error(str) {
    announce("Connection error: " + str, 'red');
    $("#connection_error").text(str).slideDown();
}

function on_blur() {
    window_focused = false;
}
function on_focus() {
    window_focused = true;
    if(alert_message) {
        alert_message = false;
        if(alert_message_interval != undefined) {
            clearInterval(alert_message_interval);
            alert_message_interval = undefined;
        }
        //needs a timeout or else it won't work, wat.
        setTimeout(update_document_title, 800);
    }
}
function push_alert_message() {
    if(!window_focused && !alert_message) {
        alert_message = true;
        alert_message_i = 0;
        alert_message_interval = setInterval(alert_message_step, 200);
    }
}

function alert_message_step() {
    var str = ALERT_TITLE.substring(alert_message_i);
    if(alert_message_i != 0)
        str += " / " + ALERT_TITLE.substring(0, alert_message_i);
    if(++alert_message_i >= ALERT_TITLE.length)
        alert_message_i = 0;
    document.title = str;
}

function update_document_title() {
    if(alert_message) return; //handled in the onfocus function
    var title;
    if(video_title != "")
        title = video_title;
    else
        title = DEFAULT_TITLE;
    document.title = title;
}


/*
 * JavaScript Pretty Date
 * Copyright (c) 2008 John Resig (jquery.com)
 * Licensed under the MIT license.
 */
function prettyDate(date) {
    //var date = new Date((time || "").replace(/-/g,"/").replace(/[TZ]/g," ")),
    var diff = (((new Date()).getTime() - date.getTime()) / 1000), day_diff = Math.floor(diff / 86400);

    if(isNaN(day_diff) || day_diff < 0 /* || day_diff >= 31 */) return;

    return day_diff == 0 && (
        diff < 60 && "just now" ||
        diff < 120 && "1 minute ago" ||
        diff < 3600 && Math.floor(diff / 60) + " minutes ago" ||
        diff < 7200 && "1 hour ago" ||
        diff < 86400 && Math.floor(diff / 3600) + " hours ago") ||
        day_diff == 1 && "1 day ago" ||
        day_diff < 7 && day_diff + " days ago" ||
        Math.floor(day_diff / 7) + " weeks ago";
}


// functions for the api calls
var yt_player_queue = {}; //queues a video to play when the player is done initial loading
var yt_player_progress_type = null; //0 = progress bar, 1 = slider
var yt_player_progress_target;
var yt_player_user_seeking = false;
var yt_player_ready = false;

function init_youtube_player() {

    var tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";

    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

// This function creates an <iframe> (and YouTube player) after the API code downloads.
var yt_player;
function onYouTubeIframeAPIReady() {
    yt_player = new YT.Player('player', {
        height: Math.floor(600 * 365 / 640),
        width: 600,
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onYoutubePlayerError,
        },
        playerVars: {
            'autoplay': 0,
            'controls': 0,
            'fs': 0,
            'playsinline': 1,
            'rel': 0,
            'showinfo': 0,
            'enablejsapi': 1,
            'disablekb': 1,
	    'iv_load_policy' : 3,
        },
    });

}

function onPlayerReady(event) {
    yt_player_ready = true;

    if(yt_player_queue.id != undefined) {
        player_put_video(yt_player_queue.id, yt_player_queue.start_time, yt_player_queue.play);
    }

    player_build_controls();
    setTimeout(function() {
        var vol_label = $("#video_volume_label");
        vol_label.text("vol: " + yt_player.getVolume() + "%");
        $("#video_volume_slider")
            .slider("option", "value", yt_player.getVolume())
            .bind('slide', function (event, ui) {
                yt_player.setVolume(ui.value);
                vol_label.text("vol: " + yt_player.getVolume() + "%");
            });
    }, 1000); // Race condition - quick fix
    setInterval(function () {
        //dont update if duration is 0 or no progress bar loaded or buffering
        var player_state = yt_player.getPlayerState();
        if(yt_player.getDuration() == 0 || yt_player_progress_type === null || player_state == 3) return;
        var current_time = yt_player.getCurrentTime();
        var duration = yt_player.getDuration();
        var value = 100 * current_time / duration;
        //calc the loaded bar
        var total_bytes = yt_player.getVideoBytesTotal();
        var start_bytes = yt_player.getVideoStartBytes();
        var loaded_bytes = yt_player.getVideoBytesLoaded();
        var loaded_percent = 0;
        var start_percent = 0;
        if(total_bytes != 0) {
            loaded_percent = loaded_bytes / (total_bytes);
            start_percent = start_bytes / total_bytes;
        }

        if(yt_player_progress_type === 0) {
            yt_player_progress_target.progressbar("option", "value", value);
        } else if(yt_player_progress_type === 1 && !yt_player_user_seeking) {
            yt_player_progress_target.slider("option", "value", value);
            $("#video_progress_bar .ui-slider-range-min")
                .css("width", Math.floor(loaded_percent * 100) + "%")
                .css("left", Math.floor(start_percent * 100) + "%");
        }
        var bar_parent = yt_player_progress_target.parent();
        var label1 = Math.floor(current_time);
        var label2 = Math.floor(duration);
        if(label1 == -1) label1 = 0;
        if(label2 == -1) label2 = 0;
        //format into minutes and stuff
        label1 = format_minutes(label1);
        label2 = format_minutes(label2);
        $("#video_progress_label_1", bar_parent).text(label1);
        $("#video_progress_label_2", bar_parent).text(label2);
    }, 200);
    setInterval(send_client_info, CLIENT_INFO_INTERVAL);

}

// The API calls this function when the player's state changes.
function onPlayerStateChange(event) {
    if(event.data == YT.PlayerState.BUFFERING && !player_quality_set && false) { //is now a param in cuevideobyid
        player_set_quality();
        player_quality_set = true;
    }

}

function onYoutubePlayerError(code) {
    var str = "Unknown error: " + code;
    if(code == 2) str = "Invalid Youtube video ID.";
    if(code == 100) str = "Youtube video not found.";
    if(code == 101 || code == 150) str = "Video does not allow embedded playback.";
    announce("Youtube Player Error: " + str, "red");
}

function format_minutes(seconds) {
    var x = seconds % 60;
    if(x < 10) x = "0" + x;
    return Math.floor(seconds / 60) + ":" + x;
}

//can return a floating point value
function player_get_time() {
    if(!yt_player_ready) return 0;
    return yt_player.getCurrentTime();
}
//can return a floating point value
function player_get_duration() {
    if(!yt_player_ready) return 0;
    return yt_player.getDuration();
}

function player_build_controls() {
    yt_player_progress_type = null;
    yt_player_user_seeking = false;
    $("#video_variable_controls").html("<div id=\"video_progress\">" +
        "<div id=\"video_progress_bar\"></div>" +
        "<div id=\"video_progress_label\">" +
        "<span id=\"video_progress_label_1\"></span>" +
        "<span id=\"video_progress_label_2\"></span>" +
        "</div>" +
        "</div>");
    if(yourRemote) {
        if(is_channel)
            $("#video_variable_controls").append("<button id=\"video_next\"></button>");
        else
            $("#video_variable_controls").append("<button id=\"video_pause\"></button>");
        $("#video_progress_bar")
        //.slider({range:"min", min:0, max:100})
            .slider({range: "min", min: 0, max: 100})
            .bind('slidestart', function (event, ui) {
                yt_player_user_seeking = true;
            })
            .bind('slidestop', function (event, ui) {
                if(yourRemote) {
                    var time = $("#video_progress_bar").slider("option", "value") * player_get_duration() / 100;
                    send_event('video_action', {action: 'seek', video_time: time});
                }
                yt_player_user_seeking = false;
            });
        yt_player_progress_target = $("#video_progress_bar");
        yt_player_progress_type = 1;
        $("#video_pause")
            .button({icons: {primary: 'ui-icon-pause'}})
            .click(function () {
                if(yourRemote && !is_channel) {
                    send_event('video_action', {action: 'toggle_pause', video_time: Math.floor(player_get_time())});
                }
            });
        $("#video_next")
            .button({icons: {primary: 'ui-icon-seek-end'}})
            .click(function () {
                if(yourRemote && is_channel) {
                    send_event('video_action', {action: 'next'});
                }
            });
    } else {
        $("#video_progress_bar").progressbar();
        yt_player_progress_target = $("#video_progress_bar");
        yt_player_progress_type = 0;
    }
}

function player_put_video(id, start_time, play) {
    if(_player_put_timeout != undefined)
        clearTimeout(_player_put_timeout);
    if(start_time == undefined)
        start_time = 0;
    if(play == undefined)
        play = true;
    if(!yt_player_ready) {
        yt_player_queue = {id: id, start_time: start_time, play: play};
        return;
    }
    _player_put(id, start_time, play, 0);
}

function _player_put(id, start_time, play, attempt_num) {
    try { //"Error calling method on NPObject."
        player_quality_set = false;
        yt_player.cueVideoById(id, start_time, player_quality);
        if(play)
            yt_player.playVideo();
    } catch(e) {
        debug("setting the video threw: " + e);
        if(attempt_num++ > 10)
            return announce("Error setting video after numerous attempts. I blame Adobe(R)(TM).", "red");
        _player_put_timeout = setTimeout(_player_put, 200, id, start_time, play, attempt_num);
    }
}

//both params are optional
function player_change_state(play, start_time) {
    if(!yt_player_ready) {
        if(play !== undefined)
            yt_player_queue.play = play;
        if(start_time !== undefined)
            yt_player_queue.start_time = start_time;
    } else {
        if(start_time !== undefined) { //TODO: look at the distance to see if this is worth it
            yt_player.seekTo(start_time, true);
        }
        if(play !== undefined) {
            var state = yt_player.getPlayerState();
            if(play && state == 2) {
                yt_player.playVideo();
            } else if(!play && state == 1) {
                yt_player.pauseVideo();
            }
        }
    }
}

function player_stop() {
    if(!yt_player_ready || yt_player === undefined || yt_player.stopVideo === undefined) {
        yt_player_queue = {};
        return;
    }
    yt_player.stopVideo();
}

function player_set_quality(q) {
    if(q != undefined)
        player_quality = q;
    if(yt_player != undefined)
        yt_player.setPlaybackQuality(player_quality);
}

function send_client_info() {
    send_event('client_info', {video_time: Math.floor(player_get_time())});
}

function give_remote(id) {
    if(yourRemote)
        send_event("give_remote", {to_sess_id: id});
}

function change_name(name) {
    if(name == undefined || name == "") return;
    if(validName(name))
        send_event("change_name", {name: name});
    else
        announce("Invalid name. Alphanumeric characters and underscores only.", "red");
}

function escape(text) {
    if(text == undefined) return "";
    return $('<span>').text(text).html();
}

//takes a User object (sess_id, name, color array)
function fancyName(user) {
    return "<span class=\"user " + user.color + " user_sess_" + user.sess_id + "\">" + user.name + "</span>";
}

function addTextMessage(user, text) {
    //sanatize the text
    //text = escape(text);
    //not any more

    var post = fancyName(user)
    post += ": " + text;
    post += "<br>";

    var messageArea = $("#message_area");
    messageArea.append(post);
    messageArea.scrollTop(messageArea[0].scrollHeight);
}

function announce(text, color) {
    var post = "<span class='notice'";
    if(color != undefined)
        post += " style='color:" + color + "'";
    post += ">" + text + "</span><br>";

    var messageArea = $("#message_area");
    messageArea.append(post);
    messageArea.scrollTop(messageArea[0].scrollHeight);

}

function build_user_list() {
    var list = [];
    var give_remote_link = "<a href=\"#\" onclick=\"give_remote(ID); return false\">Give Remote</a>";
    var change_name_link = "<a href=\"#\" onclick=\"change_name(prompt('Name','')); return false\">Change Name</a>";
    for(var sess_id in user_list) {
        var links = (sess_id == yourSession ? change_name_link : "") +
            (sess_id != yourSession && yourRemote ? give_remote_link.replace(/ID/g, sess_id) : "");
        var dropdown = (links.length != 0 ? "<div class=\"user_dropdown\">" + links + "</div>" : "");
        list.push("<span class=\"user_dropdown_container" + (dropdown.length != 0 ? " user_dropdown_clickable" : "") + "\">" +
            fancyName(users[sess_id]) +
            dropdown +
            "</span>");
    }
    var html = "users: " + list.join(", ");
    $("#user_list").html(html);
    $("#user_list .user_sess_" + remoteSessId).addClass("has_remote");
    $("#user_list .user_sess_" + yourSession).addClass("user_you");
    $(".user_dropdown_clickable").click(function () {
        $(".user_dropdown", this).show();
    });
    $(".user_dropdown_clickable").hover(function () {
    }, function () {
        $(".user_dropdown", this).hide();
    });
}

function set_room_title(title) {
    room_title = title;

    var label = $("#room_title_label"),
        entry = $("#room_title_entry");
    entry.val(title);
    if(title == "")
        title = "[untitled room]";
    label.html("<div><small>(" + (is_channel ? "_" : "#") + yourRoom + ")</small> " + escape(title) + "</div>");


    if(yourRemote && !is_channel) {
        label.children().addClass("room_title_label_editable");
        label.children().tipTip({
            content: 'click to edit'/*,
             position: {corner: {tooltip: "topMiddle", target: "bottomMiddle"}},
             style: {
             border: {width: 3, radius: 3},
             padding: 10,
             textAlign: 'center',
             tip: true,
             name: "light"
             }*/
        });
    } else {
        //label.removeClass("room_title_label_editable");
        //if(label.data("qtip")) label.qtip("destroy");
    }

    //is the title entry open?
    if(entry.css("display") == "block") {
        entry.css("display", "none");
        label.css("display", "block");
    }
}

function build_room_history() {
    var html = "<table><tr>";
    for(var i in room_history) {
        var e = room_history[i];
        html += "<td><a href=\"#" + e.id + "\" class=\"pane_item\">" +
            e.id + "</a></td>";
    }
    html += "</tr></table>";
    $("#room_history").html(html);
}

function update_uptime() {
    if(server_start_time != undefined)
        $("#server_uptime").text("(" + prettyDate(new Date(server_start_time)) + ")");
}

function validName(name) {
    return (new RegExp("^\\w{1," + MAX_NAME_LEN + "}$").test(name));
}

function sendMessage() {
    var text = $("#chat_entry").attr("value");

    if(text.length == 0) return;

    //is this a command?
    if(text.charAt(0) == "/") {
        var param;
        //this fancy code just matches the result from regex into param
        if(param = (/^\/(name|nick) (.+)/.exec(text) || {})[2]) {
            change_name(param);
        } else if(param = (/^\/(give) (.+)/.exec(text) || {})[2]) {
            var whom = param.toLowerCase();
            var whom_sess_id = null;
            for(var sess_id in user_list) {
                if(users[sess_id].name.toLowerCase() == whom.toLowerCase()) {
                    if(whom_sess_id != null)
                        return announce("multiple user matches.");
                    whom_sess_id = sess_id;
                }
            }

            if(whom_sess_id === null) {
                return announce("User not found.");
            } else {
                send_event("give_remote", {to_sess_id: whom_sess_id});
            }
        } else if(text.indexOf("/help") == 0) {
            listCommands();
        } else {
            announce("Unknown command, use /help for a list.");
        }
    } else {
        if(text.length < CHAT_SIZE_LIMIT) {
            send_event('msg', {msg: text});
        } else {
            announce("Message too long.");
            return;
        }
    }

    // clear it
    $("#chat_entry").attr("value", "");
}

function listCommands() {
    announce("Paste a youtube link to play it.");
    announce("Commands:");
    announce("/name NAME - sets your user name to NAME");
    announce("/give NAME - passes the remote to NAME");

}

function set_video(x) {
    send_event('msg', {msg: "http://youtube.com/watch?v=" + x});
}

function announce_playing(title) {
    video_title = title;
    $("#video_title").html(video_title);
    announce("Now playing: " + video_title);
    update_document_title();
}

function send_event(event, data) {
    if(disconnect) return;
    if(debug_io && event != "client_info") {
        debug("send event: " + event);
        debug(data);
    }
    var payload = {"event": event};
    if(data !== undefined)
        payload.data = data;
    socket.json.send(payload);
}

function handle_response(resp) {
    if(disconnect) return;
    var event = resp['event'];
    var data = resp['data'];
    if(debug_io && event != "client_info") {
        debug("recv event: " + event);
        debug(data);
    }
    // join room
    if(event == 'welcome') {
        yourSession = data.user.sess_id;
        users[yourSession] = data.user;
        //are we out of date from the server?
        if(server_version_hash != undefined && data.server_version_hash != server_version_hash) {
            connection_error("An update has been pushed to the server, please refresh to load the new version.");
            if($("#room_stuff").is(":visible"))
                $("#room_stuff").fadeTo("slow", .2);
            send_event('leave_room');
            disconnect = true;
            socket.disconnect();
            return;
        }
        server_version = data.server_version;
        server_version_hash = data.server_version_hash;
        server_start_time = data.start_time;
        var start_date = new Date(data.start_time);
        var hour = start_date.getHours();
        var time_str = (hour > 12 ? hour - 12 : (hour == 0 ? 12 : hour)) + ":" + start_date.getMinutes() + (hour > 11 ? "pm" : "am");
        $("#server_info").text("v" + server_version + " started " + (start_date.getMonth() + 1) + "/" + start_date.getDate() + " " + time_str + ".");
        update_uptime();
        if(get_popular_rooms_interval_id != undefined)
            clearInterval(get_popular_rooms_interval_id);
        get_popular_rooms();
        get_popular_rooms_interval_id = setInterval(get_popular_rooms, 1500);
    } else if(event == 'resume_session_ok') {
        announce("Reconnected and session resumed!");
    } else if(event == 'resume_session_fail') {
        //we cannot resume this session for some reason
        //let's just try to restart the connection?
        announce("Reconnected, but could not resume your session. Creating new session.. (I hope this works)");
        send_event("hello");
        if(yourRoom != undefined)
            send_event('join_room', {room_id: yourRoom});
    } else if(event == 'join_room_success') {
        yourRoom = data.room_id;
        is_channel = data.is_channel;
        var id = (is_channel ? "_" : "!") + data.room_id;
        window.location.hash = "#" + id;
        room_history.push({id: id,});
        $("#connecting, #intro_text").hide();
        $("#room_stuff").fadeIn();
        $("#message_area").html("");
        if(get_popular_rooms_interval_id != undefined)
            clearInterval(get_popular_rooms_interval_id);
        set_room_title("");
        build_room_history();
    } else if(event == 'join_room_error') {
        connection_error("Error joining room.");

        // sync
    } else if(event == 'sync') {
        var users_list = data.users;
        user_list = {};
        for(var i in users_list) {
            users[i] = users_list[i];
            user_list[i] = true;
        }
        if(data.video != null) {
            player_put_video(data.video, data.video_time, data.paused == false);
            announce_playing(data.video_title);
        } else {
            player_stop();
            $("#video_title").html("");
        }
        set_room_title(data.room_title);
        build_user_list();

    } else if(event == 'client_info') {
        var html = "";
        for(var i in data.info) {
            var arr = data.info[i];
            html += fancyName(arr.user) + ": " + format_minutes(arr.video_time) + "<br>";
        }
        $("#top_panel_5").html(html);
        $("#top_panel_5 .user_sess_" + remoteSessId).addClass("has_remote");
        $("#top_panel_5 .user_sess_" + yourSession).addClass("user_you");
        // messages
    } else if(event == 'msg') {
        addTextMessage(data, data.msg);
        //handle emoticons
        for(var i in data.emoticons) {
            var e = data.emoticons[i];
            //set the proper css data
            $("#emoticon_" + e.id).css({
                width: e.width,
                height: e.height,
                background: "url(" + e.image + ") 0px 0px no-repeat"
            });
            //set up a timeout for the next step
            //but only once the image has loaded
            (function (e) {
                if(e.frames > 1) {
                    if(loaded_emoticons[e.image] == undefined) {
                        $('<img>').attr("src", e.image).load(function () {
                            loaded_emoticons[e.image] = true;
                            setTimeout(animate_emoticon, e.step_ms, e, 1);
                        });
                    } else {
                        setTimeout(animate_emoticon, e.step_ms, e, 1);
                    }
                }
            }(e)); //lol anonymous function, to preserve the value of 'e'
        }
        push_alert_message();
    } else if(event == 'msg_bad') {
        announce("Invalid message entered", "red");

    } else if(event == 'room_title_set') {
        set_room_title(data.title);
        announce("The room topic is now: " + escape(data.title));
        // names
    } else if(event == 'change_name') {
        announce(fancyName(data.old_user) + " changed their name to " + fancyName(data.user) + ".");
        users[data.user.sess_id] = data.user;
        if(data.user.sess_id == yourSession)
            yourName = data.user.name;
        build_user_list();
    } else if(event == 'name_bad') {
        announce("Invalid name. Alphanumeric characters and underscores only.", "red");
    } else if(event == 'name_ok') {
        //actually, just listen for the change_name event
    }

    else if(event == 'search_message') {
	show_search_message(data.data);
    }

    else if(event == 'search_results') {
	show_search_results(data);
    }

    // remote
    else if(event == 'no_remote') {
        announce("You don't have the remote.", "red");
        $("#top_panel_labels").hide();
    } else if(event == 'transfer_remote') {
        remoteSessId = data.sess_id;
        yourRemote = (remoteSessId == yourSession);
        announce(fancyName(data) + " has the remote.");
        build_user_list();
        player_build_controls();
        set_room_title(room_title);
        if(yourRemote && !is_channel) {
	    $("#top_panel_labels").show();
            // open search for remote holder
            toggle_panel(4);
        }
        else {
            // close search and hide if giving up remote
	    if(!yourRemote && curr_top_panel == 4) {
                toggle_panel(4);
                $("#top_panel_labels").hide();
            }
        }
    }

    // users
    else if(event == 'user_join') {
        announce(fancyName(data) + " joined.");

        users[data.sess_id] = data;
        user_list[data.sess_id] = true;
        build_user_list();
        listCommands();
    } else if(event == 'user_leave') {
        announce(fancyName(data) + " left.");
        delete user_list[data.sess_id];
        build_user_list();
    } else if(event == 'invalid_user') {
        announce('Invalid user.');

        // video
    } else if(event == 'video_set') {
        $("#video_title").html("");
        player_put_video(data.video_id);
    } else if(event == 'video_info') {
        announce_playing(data.title);
    } else if(event == 'video_action') {
        if(data.action == "seek") {
            player_change_state(undefined, data.video_time);
        } else {
            player_change_state(data.action == "resume", data.video_time);
        }
    } else if(event == 'invalid_video') {
        announce("Sorry, couldn't understand that video.");

        // popular room listing
    } else if(event == 'popular_rooms') {
        popular_rooms_cache = data;

        var html = "", top_panel_arr = [];
        for(var j in popular_room_gen_data) {
            var e = popular_room_gen_data[j];
            html += "<strong>" + e.title + ":</strong><br>";
            var table_html = "<table class=\"room_listing\">";
            for(var i in data[e.data]) {
                var room = data[e.data][i];
                var link = "<a href=\"#" + e.id + room.id + "\">#" + e.display_prefix + room.id + "</a>";
                top_panel_arr.push(link + (room.num_users > 0 ? " (" + room.num_users + ")" : ""));
                table_html += "<tr" + (i % 2 == 0 ? " class=\"table_row_even\"" : "") + ">";
                var num = "(" + room.num_users + ")";
                if(room.num_users == 0)
                    num = "<span class=\"room_empty\">" + num + "</span>";
                table_html += "<td>" + link + "&nbsp;" + num + "</td>";
                if(e.show_title)
                    table_html += "<td>" + escape(room.title) + "</td>";
                if(room.video_title != "")
                    table_html += " <td><span class=\"play_icon\"></span> <i>" + room.video_title + "</i></td>";
                table_html += "</tr>";
            }
            table_html += "</table>";
            html += table_html;
            if(data[e.data].length == 0)
                html += e.none + "<br>";
            html += "<br>";
        }

        if(last_popular_room_html != html)
            $("#popular_rooms").html(html);
        last_popular_room_html = html;
        $("#top_panel_1").html(top_panel_arr.join(", "));

    } else if(event == 'pong') {
        var latency = Date.now() - ping_time;
        $("#server_latency").text("Latency: " + latency + "ms");
    }
}

function animate_emoticon(data, frame) {
    //set the new background offset
    $("#emoticon_" + data.id).css('background-position', "0px -" + (data.height * frame) + "px");
    //trigger a new animation, if needed
    if(frame < data.frames - 1)
        setTimeout(animate_emoticon, data.step_ms, data, frame + 1);
}

var curr_top_panel = null;
function toggle_panel(x) {
    $("#top_panel_labels a").removeClass('top_panel_label_selected');
    if(x == curr_top_panel) {
        curr_top_panel = null;
        $("#room").stop().animate({'top': '0px'}, 'fast');
    } else {
        $(".top_panel").hide();
        $("#top_panel_label_" + x).addClass('top_panel_label_selected');
        $("#top_panel_" + x).show();
        curr_top_panel = x;
        $("#room").stop().animate({'top': '160px'}, 'fast');
        if(x == 1)
            get_popular_rooms();
        if(x == 4)
            $('#search_youtube_input').focus();
    }
}

function search_youtube() {
	send_event('search_youtube', {
		query: $("#search_youtube_input").val(), 
                client: yourSession
	});
	show_search_message("Loading...");
}

function show_search_message(message) {
                var html = "<span class='notice'>" +
			message +
			"</span>";
                $("#search_youtube_results").html(html);
}

function show_search_results(data) {
	if (data == undefined || data.data == undefined || data.data.length < 1) {
		show_search_results("No results found.");
	}
	else {
                var html = "<table><tr>"; //oh god I am so sorry it came to this
                for(var i in data.data) { 
                	var title = $('<span>').text(data.data[i].title).html()
                    	html += "<td><a href=\"#\" onclick=\"set_video('" + 
				data.data[i].id + 
				"');return false\" class=\"pane_item youtube_result\">" +
                        	"<div style=\"text-align:center\">" +
                        	"<img src=\"" + data.data[i].thumbnail + "\">" +
                        	"</div>" +
                        	title + 
				"</a></td>";
                }
                html += "</tr></table>";
                $("#search_youtube_results").html(html);
	}
}

var curr_hash;
function check_hash_change() {
    if(window.location.hash != curr_hash) {
        curr_hash = window.location.hash;
        if((curr_hash.length == ROOM_ID_LEN + 2 && curr_hash.charAt(1) == '!') || //is a room id
            (curr_hash.length >= 3 && curr_hash.charAt(1) == '_')) { //or is a channel id

            var room_id = window.location.hash.substr(2);
            var is_channel = (curr_hash.charAt(1) == '_');
            if(room_id != yourRoom) {
                $("#join_room_buttons, #popular_rooms").hide();
                $("#connecting").fadeIn();
                send_event('join_room', {room_id: room_id, is_channel: is_channel});
            }
        }
    }
}

//pulse the logo
function logo_pulse_in() {
    if(yourRoom != undefined) return;
    $("#big_logo_glow").animate({opacity: 1}, 1500, logo_pulse_out);
}
function logo_pulse_out() {
    if(yourRoom != undefined) return;
    $("#big_logo_glow").delay(500).animate({opacity: 0}, 2000, logo_pulse_in);
}

function get_popular_rooms() {
    send_event('get_popular_rooms');
}
function ping() {
    ping_time = Date.now();
    send_event('ping');
}

function socket_on_disconnect() {
    $("#connection_status").text("Disconnected.");
    if(disconnect) return;
    announce("Connection lost. Attempting to reconnect..");
    setTimeout(reconnect, 1000);
}
function reconnect() {
    if(socket.connected || disconnect) return;
    //socket.disconnect();
    //socket.connect();
    socket = io.connect();
    if(yourSession != undefined) {
        send_event("resume_session", {sess_id: yourSession});
    } else {
        send_event("hello");
    }
    setTimeout(reconnect, 3000);
}

function init() {
    if(/*@cc_on!@*/false) { // check for Internet Explorer
        debug("ie mode");
        document.onfocusin = on_focus;
        document.onfocusout = on_blur;
    } else {
        window.onfocus = on_focus;
        window.onblur = on_blur;
    }

    //what is remoteremote text:
    var what_is_height = $("#what_is_text").height();
    $("#what_is_arrow")
        .removeClass("what_is_arrow_down")
        .addClass("what_is_arrow_right");
    $("#what_is_text").hide().css({height: 0});
    $("#what_is").click(function () {
        var arrow = $("#what_is_arrow");
        if(arrow.hasClass("what_is_arrow_right")) {
            arrow
                .removeClass("what_is_arrow_right")
                .addClass("what_is_arrow_down");
            $("#what_is_text").stop(true).show().animate({height: what_is_height}, 'fast');
        } else {
            arrow
                .removeClass("what_is_arrow_down")
                .addClass("what_is_arrow_right");
            $("#what_is_text").stop(true).animate({height: 0}, {
                duration: 'fast', complete: function () {
                    $(this).hide()
                }
            });
        }
        return false;
    });

    logo_pulse_in();

    $("#join_random_button").click(function () {
        send_event('join_room');
        $("#join_room_buttons, #popular_rooms").hide();
        $("#connecting").fadeIn();
        return false;
    });

    $("#chat_entry").keypress(function (e) {
        if(e.keyCode != 13) return;
        sendMessage();
    });

    $("#video_volume_slider").slider({range: "min", min: 0, max: 100});
    $("#video_hd").button({"label": "HD is off"}).click(function () {
        if(player_quality == "default") {
            player_set_quality("hd720");
            $(this).button("option", "label", "HD is on");
        } else {
            player_set_quality("default");
            $(this).button("option", "label", "HD is off");
        }
    });

    init_youtube_player();

    // socket.io stuff
    //socket = new io.Socket("sam.no.de", {rememberTransport: false, transports:['websocket', 'flashsocket', 'htmlfile', 'xhr-multipart', 'xhr-polling']});
    socket = io.connect();
    socket.on('connect', function () {
        announce("Connected.");
        $("#connection_status").text("Connected.");
    });
    socket.on('connecting', function (transport_type) {
        $("#connection_status").text("Connecting..");
        last_transport_attempted = transport_type;
    });
    socket.on('disconnect', socket_on_disconnect);
    socket.on('message', handle_response);

    //socket.connect();
    send_event("hello");

    setInterval(check_hash_change, 200);
    setInterval(update_uptime, 1000 * 60); //once a minute
    setInterval(ping, 1000 * 10); //once every 10 secs

    //room title input
    $("#room_title_label").click(function () {
        if(!$(this).children().hasClass("room_title_label_editable")) return;
        $("#room_title_label").css("display", "none");
        $("#room_title_entry").css("display", "block").focus().select();
    });
    $("#room_title_entry").attr("maxlength", MAX_ROOM_TITLE_LEN).live('keydown', function (e) {
        if(e.which != 13 && e.which != 9) return;
        e.preventDefault();
        var value = $("#room_title_entry").val();
        if(yourRemote && room_title != value)
            send_event('set_room_title', {title: value});
        $("#room_title_entry").css("display", "none");
        $("#room_title_label").css("display", "block");
    });

    //set up youtube search
    $("#search_youtube_input")
        .keypress(function (e) {
            if(e.which != 13) return;
            search_youtube();
        })/*
     .qtip({
     content: 'sneaky sound system\nby:youresam',
     show: { when: { event: 'focus' } },
     hide: { when: { event: 'blur' } },
     position: {corner: {tooltip: "topMiddle", target: "bottomLeft"}},
     style: { border: {width: 3, radius: 3}, padding: 10,
     textAlign: 'center', tip: true, name: "light"}
     });*/
    /*.tipTip({
     activation: 'focus',
     content: 'sneaky sound system\nby:youresam'
     })*/;

    $("#footer_about").click(function () {
        $("<div style=\"text-align:left;font-size:12pt\">" +
            "<p>remoteremote.com is a site to share YouTube videos with friends. Create a room and share the link with your friends.</p>" +
            "<p>Don't know what to watch? Simply join a premade channel.</p>" +
            "<p>remoteremote.com is a creation of Team Duck, coded by Sam (backend+frontend) and Greg (some of the frontend) and then James seven years later.</p>" +
            "</div>").dialog({
            width: 600,
            modal: true,
            show: "fade",
            hide: "fade",
            buttons: {
                Ok: function () {
                    $(this).dialog("close");
                }
            }
        });
        return false;
    });
    if(Math.random() < .5)
        $("body").css("background-image", "url(bg-alt.jpg)");
}

$(init);

$(window).unload(function () {
    send_event('leave_room');
});
