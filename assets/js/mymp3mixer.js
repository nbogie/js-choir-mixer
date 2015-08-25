"use strict";
var gBufferList;
var context;
var bufferLoader;
var sourceAndGainPairs;
var isPlaying; //Fixme: ask the API, instead

var posOffset = 0;
var playStartedTime = -1;
var playStartedOffset; // a snapshot of posOffset at start of current play
 
function BufferLoader(context, urlList, callback) {
  this.context = context;
  this.urlList = urlList;
  this.onload = callback;
  this.bufferList = [];
  this.loadCount = 0;
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
  context = new AudioContext();
  isPlaying = false;
  var songDir = "deep_river"; //"as";
  bufferLoader = new BufferLoader(
    context,
    ['soprano', 'alto', 'tenor'].map(function(n) {
      return "sounds/" + songDir + "/" + n + ".mp3";
    }),
    finishedLoading
    );

  bufferLoader.load();

}


function createBuffer(b){
  var src = context.createBufferSource();
  src.buffer = b;
  return src;
}

function createGainedBuffer(b){
  var src = createBuffer(b);
  var gainNode = linkThroughGain(src);
  return {src: src, gainNode: gainNode};
}

function createAllBuffers(bufferList){
  sourceAndGainPairs = bufferList.map(function (buf) { 
    return createGainedBuffer(buf);
  });
}

function finishedLoading(bufferList) {
  gBufferList = bufferList;
  // Create three sources and play them both together.
  createAllBuffers(bufferList);
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
function changeVolume(thing){
  //TODO: volume changes while no buffers loaded must be allowed, and must persist when buffers are reloaded (e.g. play position changed and all recreated).
  // The gain nodes won't necessarily exist?  Perhaps: hold a proxy for each gain setting, and map this on play() to the gain node, as well as immediately on slider changes, if applicable.

  var numstr = thing.id.substring(3,4);
  var num = parseInt(numstr);
  var val = parseInt(thing.value);
  

  var pair = sourceAndGainPairs[num - 1];
  console.log("changeVolume "+ thing.id + " num: "+ num +" val: " + thing.value + " value: " + val + " and val-1 is " + (val -1) + " and that pair is " + pair);
  
  var gainNode = pair.gainNode;
  gainNode.gain.value = val/100.0;
  //console.log("node gain is now: " + gainNode.gain.value);

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
 
function play(){
  if (isPlaying){
    stop();
    isPlaying = false;    
  }
  createAllBuffers(gBufferList);
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
    var elapsedSecs = context.currentTime - playStartedTime;
    var trackTime = playStartedOffset + elapsedSecs;
    var snapshotName = document.getElementById("snapshotName").value;
    var elem = document.getElementById("snapshots");
    elem.innerHTML = elem.innerHTML + "<li>" + snapshotName + ": " + trackTime + "s</li>";
  }
}