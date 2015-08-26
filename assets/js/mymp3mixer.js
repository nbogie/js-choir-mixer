"use strict";
var gBufferList;
var context;
var bufferLoader;
var sourceAndGainPairs;
var trackNames;

var isPlaying; //Fixme: ask the API, instead

var posOffset = 0;
var playStartedTime = -1;
var playStartedOffset; // a snapshot of posOffset at start of current play
 
function BufferLoader(context, urlList, callback) {
  this.context    = context;
  this.urlList    = urlList;
  this.onload     = callback;
  this.bufferList = [];
  this.loadCount  = 0;
}

 function loadJSONSync(path, callback) {   

    var xobj = new XMLHttpRequest();
        xobj.overrideMimeType("application/json");
    xobj.open('GET', path, false);
    xobj.onreadystatechange = function () {
          console.log("on ready from geting " + path + " readystate: " + xobj.readyState + " and status: " + xobj.status);
          if (xobj.readyState == 4 && xobj.status == 0) { // TODO: "200" when web-served.
            // Required use of an anonymous callback as .open will NOT return a value but simply returns undefined in asynchronous mode
            callback(xobj.responseText);
          }
    };
    xobj.send(null);  
 }
 


BufferLoader.prototype.loadBuffer = function(url, index) {
  // Load buffer asynchronously
  var request = new XMLHttpRequest();
  request.open("GET", url, true);
  request.responseType = "arraybuffer";

  var loader = this;

  request.onload = function() {
    // Asynchronously decode the audio file data in request.response
    loader.context.decodeAudioData(
      request.response,
      function(buffer) {
        if (!buffer) {
          alert('error decoding file data: ' + url);
          return;
        }
        loader.bufferList[index] = buffer;
        if (++loader.loadCount == loader.urlList.length)
          loader.onload(loader.bufferList);
      },
      function(error) {
        console.error('decodeAudioData error', error);
      }
    );
  };

  request.onerror = function() {
    alert('BufferLoader: XHR error');
  };

  request.send();
};

BufferLoader.prototype.load = function() {
  for (var i = 0; i < this.urlList.length; ++i)
  this.loadBuffer(this.urlList[i], i);
};

function initmp3mixer() {
  console.log("mymp3mixer.js init()");
  // Fix up prefixing
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  var songDirs   = ["close_to_me", "deep_river", "as", "he_has_done_marvelous_things"];
  var songDir    = songDirs[3];
  var path       = "sounds/" + songDir + "/index.json";
  loadJSONSync(path, function(response) { 
    var json = JSON.parse(response);
    trackNames = json.tracks.map(function(t) { return t.name; });
    console.log(json);
  });
  
  context      = new AudioContext();
  isPlaying    = false;
  bufferLoader = new BufferLoader(
    context,
    trackNames.map(function(n) {
      return "sounds/" + songDir + "/" + n;
    }),
    finishedLoading
    );

  bufferLoader.load();
}

function getTrailingDigit(elem,prefix) {
  var l = prefix.length;
  var numstr = elem.id.substring(l,l+1);
  return parseInt(numstr);
}

function toggleMute(elem) {
  console.log("Toggling mute on elem: " + elem.id);
  var n    = getTrailingDigit(elem, "mute");
  var pair = sourceAndGainPairs[n];
  pair.gainNode.gain.cancelScheduledValues(context);
  console.log("before: " + pair.gainNode.gain.value + " and classes " + elem.classList);
  if (elem.classList.contains("mutebutton-muted")) {
    pair.gainNode.gain.value = 1;
  } else {
    pair.gainNode.gain.value = 0;
  }  
  elem.classList.toggle("mutebutton-muted");
  console.log("after: " + pair.gainNode.gain.value + " and classes " + elem.classList);

}

function muteTracksAccordingToDOM() {
  $( ".mutebutton-muted").each(function(index) {
    var elem = this;
    var n    = getTrailingDigit(elem, "mute");
    var pair = sourceAndGainPairs[n];
    pair.gainNode.gain.cancelScheduledValues(context);
    if (elem.classList.contains("mutebutton-muted")) {
      pair.gainNode.gain.value = 0;
    } else {
      pair.gainNode.gain.value = 1;
    }
  });

}
function gainTracksAccordingToDOM() {
  $(".slider").each(function(index) {
    changeVolume(this);
  });
}

function createBuffer(b){
  var src = context.createBufferSource();
  src.buffer = b;
  return src;
}

function createGainedBuffer(b){
  var src = createBuffer(b);
  var gainNode = linkThroughGain(src);
  return {title: b, src: src, gainNode: gainNode};
}

function createAllBuffers(bufferList){
  sourceAndGainPairs = bufferList.map(function (buf) { 
    return createGainedBuffer(buf);
  });
}

function makeControlsForTrack(buf, i) {

  var group      = $("<p/>", {id: "controlrow" + i, class: "sliderrow"});
  var label      = $("<label/>", {text: trackNames[i]});//TODO: sanitise track names for security
  var muteButton = $("<input/>", {type: "submit", id: "mute" + i, value: "Mute", class: "mutebutton"});
  var slider     = $("<input/>", {type: "range", id: "vol" + i, value: "100", class: "slider", min: "0", max: "100"});
  
  group.append(label);
  group.append(muteButton);
  group.append(slider);
  $("#controlset").append(group);

  $('#vol'+i).on('change', function(e) { changeVolume(this); } );
  $('#mute'+i).on('click', function(e) { toggleMute(this); });
  
}

function createControlsInDOM(bufferList) {
  console.log("creating controls in DOM for n tracks " + bufferList);

  bufferList.forEach(function(buf, i) {
    makeControlsForTrack(buf, i);
  });
}

function finishedLoading(bufferList) {
  gBufferList = bufferList;
  // Create three sources and play them both together.
  createAllBuffers(bufferList);
  createControlsInDOM(bufferList);

  //play();
}
function wipeAllBuffers(){
  sourceAndGainPairs = [];
}

function linkThroughGain(src){
  var gainNode = context.createGain();
  src.connect(gainNode);
  gainNode.connect(context.destination);
  gainNode.gain.value = 1;
  return gainNode;
}
//expected an input html element with id "vol1" or "vol2", and value from 0 to 100.
function changeVolume(elem){
  //TODO: volume changes while no buffers loaded must be allowed, and must persist when buffers are reloaded (e.g. play position changed and all recreated).
  // The gain nodes won't necessarily exist?  Perhaps: hold a proxy for each gain setting, and map this on play() to the gain node, as well as immediately on slider changes, if applicable.

  var numstr = elem.id.substring(3,4);
  var num    = parseInt(numstr);
  var val    = parseInt(elem.value);
  
  var pair = sourceAndGainPairs[num];
  console.log("changeVolume "+ elem.id + " num: "+ num +" val: " + elem.value + " value: " + val + " and val is " + val + " and that pair is " + pair);
  
  var gainNode        = pair.gainNode;
  gainNode.gain.value = val/100.0;
}
function lengthOfSourceInSec(){
  return 182;
}

function changePosition(elem){
  posOffset = posSliderToSeconds(elem);
  document.getElementById("positionOutput").value = posOffset;
  console.log("posOffset is now: " + posOffset);
}

function posSliderToSeconds(elem){
  var val = parseFloat(elem.value);
  return Math.round(lengthOfSourceInSec() * val / parseInt(elem.max));
}

function stop(){
  playStartedTime = -1;
  var firstSource = sourceAndGainPairs[0].src;
  if(firstSource !== null){
    sourceAndGainPairs.forEach(function(pair) {
      if (pair.src !== null) {
        pair.src.stop(0);
      }
    } );
    isPlaying = false;
    wipeAllBuffers();
  }
}
 function setAllBuffersToLoop(shouldLoop) {
  sourceAndGainPairs.forEach(function(pair) {
    pair.src.loop = shouldLoop;
  } );
 }

function play(){
  if (isPlaying){
    stop();
    isPlaying = false;    
  }
  createAllBuffers(gBufferList);
  setAllBuffersToLoop(true);
  gainTracksAccordingToDOM();
  muteTracksAccordingToDOM();
  
  playStartedTime = context.currentTime;
  playStartedOffset = posOffset;
  sourceAndGainPairs.forEach(function(pair) {
    pair.src.start(0, posOffset);
  } );
  isPlaying = true;
}

function snapshotTime(){
  if (playStartedTime < 0){
    console.log("ERROR: can't yet snapshot time when stopped");
  } else {
    var elapsedSecs  = context.currentTime - playStartedTime;
    var trackTime    = playStartedOffset + elapsedSecs;
    var snapshotName = document.getElementById("snapshotName").value;
    var elem         = document.getElementById("snapshots");
    elem.innerHTML   = elem.innerHTML + "<li>" + snapshotName + ": " + trackTime + "s</li>";
  }
}