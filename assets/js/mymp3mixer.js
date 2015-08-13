var gBufferList;
var context;
var bufferLoader;
var source1, source2, source3;
var gainNode1, gainNode2, gainNode3;
var posOffset = 0;
var playStartedTime = -1;
var playStartedOffset; // a snapshot of posOffset at start of current play
 
function BufferLoader(context, urlList, callback) {
  this.context = context;
  this.urlList = urlList;
  this.onload = callback;
  this.bufferList = new Array();
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
  }

  request.onerror = function() {
    alert('BufferLoader: XHR error');
  }

  request.send();
}

BufferLoader.prototype.load = function() {
  for (var i = 0; i < this.urlList.length; ++i)
  this.loadBuffer(this.urlList[i], i);
}




function initmp3mixer() {
  console.log("mymp3mixer.js init()");
  // Fix up prefixing
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  context = new AudioContext();

  bufferLoader = new BufferLoader(
    context,
    [
      'sounds/as/soprano.mp3',
      'sounds/as/alto.mp3',
      'sounds/as/tenor.mp3',
    ],
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
  return [src, gainNode];
}

function createAllBuffers(bufferList){
  [source1, gainNode1] = createGainedBuffer(bufferList[0]);
  [source2, gainNode2] = createGainedBuffer(bufferList[1]);
  [source3, gainNode3] = createGainedBuffer(bufferList[2]);
}


function finishedLoading(bufferList) {
  gBufferList = bufferList;
  // Create three sources and play them both together.
  //createAllBuffers(bufferList);
  //play();
}
function wipeAllBuffers(){
  source1 = null;
  source2 = null;
  source3 = null;
  gainNode1 = null;
  gainNode2 = null;
  gainNode3 = null;
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
  //console.log("changeVolume "+ thing.id + " val: " + thing.value + " value: " + val);
  
  var node;
  switch(num) {
    case 1:
        node = gainNode1;
        break;
    case 2:
        node = gainNode2;
        break;
    case 3:
        node = gainNode3;
        break;
    default:
        console.log("ERROR: unexpected num: "+ num + " from id " + thing.id );
    }    
    node.gain.value = val/100.0;
    //console.log("node gain is now: " + node.gain.value);

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
  if(source1){
    source1.stop(0);
    source2.stop(0);
    source3.stop(0);
    wipeAllBuffers();
  }
}
 
function play(){
  stop();
  createAllBuffers(gBufferList);
  playStartedTime = context.currentTime;
  playStartedOffset = posOffset;
  source1.start(0, posOffset);
  source2.start(0, posOffset);
  source3.start(0, posOffset);
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