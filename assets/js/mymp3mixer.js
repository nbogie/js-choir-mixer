"use strict";
var gBufferList;
var context;
var bufferLoader;
var sourceAndGainPairs;
var trackNames;
var sectionStarts;
var songTitle;
var numFrames = 0;

var isPlaying; //Fixme: ask the API, instead

var posOffset = 0;
var playStartedTime = -1;
var playStartedOffset; // a snapshot of posOffset at start of current play
var playbackRate;

var demoWaveformConfig = { type: "waveform", size: 1024};
var demoSpectrumConfig = { type: "spectrum", size: 128};
var fftConfig = demoWaveformConfig;
 
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
          if (xobj.readyState === 4 && xobj.status === 0) { // TODO: "200" when web-served.
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
  var songDirs   = ["close_to_me", "deep_river", "as", "he_has_done_marvelous_things", "pretty_hurts", "get_lucky_the_few", "hymn_of_acxiom_the_few"];
  var songDir    = songDirs[6];
  var path       = "sounds/" + songDir + "/index.json";
  loadJSONSync(path, function(response) { 
    var json = JSON.parse(response);
    songTitle = json.title || "Untitled";
    trackNames = json.tracks.map(function(t) { return t.name; });
    sectionStarts = json.sectionStarts || [];
    playbackRate = 1;
    recreateSectionStartsInDOM();
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
  document.getElementById("songTitle").innerHTML = songTitle;
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
  src.playbackRate.value = 1;
  src.buffer = b;
  return src;
}

function createGainedBuffer(b){
  var src = createBuffer(b);
  var analyser = context.createAnalyser();
  analyser.fftSize = fftConfig.size;
  var bufferLength = analyser.frequencyBinCount;
  var dataArray = new Uint8Array(bufferLength);

  var gainNode = linkThroughGain(src);
  gainNode.connect(analyser);

  return { title: b, 
           src: src, 
           gainNode: gainNode, 
           analyser: analyser,
           dataArray: dataArray };
}

function createAllBuffers(bufferList){
  sourceAndGainPairs = bufferList.map(function (buf) { 
    return createGainedBuffer(buf);
  });
}
function simpleTrackName(i){
  var input = trackNames[i];
  return input.substr(0, input.lastIndexOf('.')) || input;
}

function makeControlsForTrack(buf, i) {

  var group      = $("<p/>", {id: "controlrow" + i, class: "sliderrow"});
  var label      = $("<label/>", {text: simpleTrackName(i), title: trackNames[i]});//TODO: sanitise track names for security
  var muteButton = $("<input/>", {type: "submit", id: "mute" + i, value: "Mute", class: "mutebutton"});
  var slider     = $("<input/>", {type: "range", id: "vol" + i, value: "100", class: "slider", min: "0", max: "100", title: "Change volume of " + trackNames[i]});
  var canvas     = $("<canvas/>", {id: "trackCanvas" + i, width:'500', height:'100'});

  group.append(label);
  group.append(muteButton);
  group.append(slider);
  group.append(canvas);
  $("#controlset").append(group);

  $('#vol'+i).on('change', function(e) { changeVolume(this); } );
  $('#mute'+i).on('click', function(e) { toggleMute(this); });
  
}

function createControlsInDOM(bufferList) {
  bufferList.forEach(function(buf, i) {
    makeControlsForTrack(buf, i);
  });
  $('#positionSlider').on('input', function(e) { handleChangePosition(this); } );
  $('#playbackRateSlider').on('input', function(e) { handleChangePlaybackRate(this); } );
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
  return sourceAndGainPairs[0].src.buffer.duration;
}


function handleChangePosition(elem){
  updatePosOffset(convertSliderValueToSeconds(elem));
}
function handleChangePlaybackRate(elem){
  updatePlaybackRate(parseFloat(elem.value));
}

function convertSliderValueToSeconds(elem){
  return Math.round(lengthOfSourceInSec() * parseFloat(elem.value) / parseInt(elem.max));
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

function drawAllAnims(){

  var sharedCanvas = document.getElementById('trackCanvas'+0);
  var canvasCtx = sharedCanvas.getContext('2d');
  canvasCtx.fillStyle = 'white';
  canvasCtx.fillRect(0, 0, sharedCanvas.width, sharedCanvas.height);

  var h = sharedCanvas.height;
  var oneYOffset = h / sourceAndGainPairs.length;

  sourceAndGainPairs.forEach(function (pair, i) {
    var yOffset = -h/2 + i*oneYOffset;
    drawOneFFT(pair.analyser, pair.dataArray, i);//, sharedCanvas, yOffset);
  });

  if (numFrames >= 0 ){
    requestAnimationFrame(drawAllAnims);
    numFrames += 1;
  }
  
}

function drawOneFFT(analyser, dataArray, i, sharedCanvas, yOffset){
  var canvasElem = sharedCanvas || document.getElementById('trackCanvas'+i);

  var canvasCtx = canvasElem.getContext('2d');
  var canvasHeight = canvasElem.height;
  var canvasWidth = canvasElem.width;

  yOffset = yOffset || 0;
//  canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);
  canvasCtx.fillStyle = 'white';
  canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  if (fftConfig.type === "spectrum") {
    analyser.getByteFrequencyData(dataArray);
  } else {
    analyser.getByteTimeDomainData(dataArray);
  }
  

  var len = dataArray.length;
  var stripeWidth = canvasWidth / len;
  var vertScale = canvasHeight / 256;
  var scaledVals = [];
  
  for(var j = 0; j < len; j++) {
    var val = dataArray[j] * vertScale;
    scaledVals.push(val);
  }  

  if (fftConfig.type === "spectrum") {
    drawSpectrum(canvasCtx, scaledVals, stripeWidth, canvasWidth, canvasHeight, yOffset);
  } else if (fftConfig.type === "waveform") {
    if (signalAboveThreshold(dataArray)) {
      drawWaveform(canvasCtx, scaledVals, stripeWidth, canvasWidth, canvasHeight, yOffset);
    }
  } else { // no fft

  }
}

function signalAboveThreshold(arr){
  var threshold = 3;
  
  for(var i = 0; i < arr.length; i+=1) {
    var val = arr[i];
    if (Math.abs(128 - val) > threshold) {
      return true;
    }
  }
  return false;

}

function drawSpectrum(canvasCtx, scaledVals, stripeWidth, w, h, yOffset){
  canvasCtx.globalAlpha = 0.5;

  canvasCtx.fillStyle = 'rgb(255, 0, 0)';
  scaledVals.forEach(function(v, i) { 
    canvasCtx.fillRect(i*stripeWidth, h - v + yOffset, stripeWidth, v);
  });
}

function drawWaveform(canvasCtx, scaledVals, step, w, h, yOffset){
  canvasCtx.lineWidth = 3;
  canvasCtx.strokeStyle = 'rgb(0, 0, 0)';
  canvasCtx.beginPath();
  var x = 0;

  scaledVals.forEach(function(v, i) { 
    var y = v + yOffset;
    if(i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
    x += step;
  });
  canvasCtx.stroke();
}

function play(){
  if (isPlaying){
    stop();
    isPlaying = false;    
  }
  createAllBuffers(gBufferList);
  setAllBuffersToLoop(true);
  setPlaybackRateForAllBuffers(playbackRate);
  gainTracksAccordingToDOM();
  muteTracksAccordingToDOM();
  
  playStartedTime = context.currentTime;
  playStartedOffset = posOffset;
  sourceAndGainPairs.forEach(function(pair) {
    pair.src.start(0, posOffset);
  } );
  var drawVisual = requestAnimationFrame(drawAllAnims);

  isPlaying = true;
}
function setPlaybackRateForAllBuffers(r){
  sourceAndGainPairs.forEach(function(pair) {
    pair.src.playbackRate.value = r;
  } );
}

function snapshotTime(){
  if (playStartedTime < 0){
    console.log("ERROR: can't yet snapshot time when stopped");
  } else {
    var elapsedSecs  = context.currentTime - playStartedTime;
    var trackTime    = playStartedOffset + elapsedSecs;
    var label = document.getElementById("snapshotName").value;
    
    sectionStarts.push({time: trackTime, label: label});
    console.log("starts: "+ sectionStarts.map(function(s) { return s.label; }));

    recreateSectionStartsInDOM();
  }
}
function updatePlaybackRate(val) {
  playbackRate = val;
  document.getElementById("playbackRateOutput").value = playbackRate;
  console.log("playbackRate is now: " + playbackRate);
}
function updatePosOffset(val) {
  posOffset = val;
  document.getElementById("positionOutput").value = posOffset;
  console.log("posOffset is now: " + posOffset);
}

function jumpToSection(i) {
  console.log("jump to section: " + i);
  //var val = convertSecondsToSliderValue(sectionStarts[i]);
  var secs = sectionStarts[i].time;
  updatePosOffset(secs);
  play();
  //TODO: update slider to reflect new position
}

function recreateSectionStartsInDOM() {
  $('#snapshots').innertHTML = "";

  sectionStarts.forEach(function(s, i) {
    var labelSpan = $('<span/>', {class: "sectionStartLabel", text: s.label});
    var timeSpan = $('<span/>', {class: "sectionStartTime", text: Math.round(s.time)});
    var listItem = $('<li/>', {class: "sectionStart", id: "sectionStart"+i});
    listItem.append(timeSpan);
    listItem.append(labelSpan);
    $('#snapshots').append(listItem);    
    $('#sectionStart'+i).on('click', function(e) { jumpToSection(i); });
    console.log("clicking " + s.label + " will jump you to " +i);
  });
}  
