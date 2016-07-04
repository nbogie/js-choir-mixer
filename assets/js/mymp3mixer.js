/*global $ */
/*global _ */

(function() {
"use strict";

if (!Array.prototype.find) {
  Array.prototype.find = function(predicate) {
    if (this === null) {
      throw new TypeError('Array.prototype.find called on null or undefined');
    }
    if (typeof predicate !== 'function') {
      throw new TypeError('predicate must be a function');
    }
    var list = Object(this);
    var length = list.length >>> 0;
    var thisArg = arguments[1];
    var value;

    for (var i = 0; i < length; i++) {
      value = list[i];
      if (predicate.call(thisArg, value, i, list)) {
        return value;
      }
    }
    return undefined;
  };
}


var gBufferList;
var context;
var bufferLoader;
var sourceAndGainPairs;
var trackNames;
var sectionStarts;
var songTitle;
var numFrames = 0;

var soloGroup;

var isPlaying; //Fixme: ask the API, instead

var posOffset = 0;
var playStartedTime = -1;
var playStartedOffset; // a snapshot of posOffset at start of current play
var playbackRate;

var myFFTConfigs = {
    waveform: {
        type: "waveform",
        size: 1024
    },
    spectrum: {
        type: "spectrum",
        size: 128
    }
};

var fftConfig = myFFTConfigs.waveform;

var useZeroCrossing;

function BufferLoader(context, urlList, callback) {
    this.context = context;
    this.urlList = urlList;
    this.onload = callback;
    this.bufferList = [];
    this.loadCount = 0;
}



BufferLoader.prototype.loadBuffer = function (url, index) {
    // Load buffer asynchronously
    var request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";

    var loader = this;

    request.onload = function () {
        // Asynchronously decode the audio file data in request.response
        loader.context.decodeAudioData(
            request.response,
            function (buffer) {
                if (!buffer) {
                    alert('error decoding file data: ' + url);
                    return;
                }
                loader.bufferList[index] = buffer;
                if (++loader.loadCount == loader.urlList.length)
                    loader.onload(loader.bufferList);
            },
            function (error) {
                console.error('decodeAudioData error', error);
            }
        );
    };

    request.onerror = function () {
        alert('BufferLoader: XHR error');
    };

    request.send();
};

BufferLoader.prototype.load = function () {
    for (var i = 0; i < this.urlList.length; ++i) {
        this.loadBuffer(this.urlList[i], i);
    }
};

function getSongInfos() {
    var songDirsFree = ["close_to_me", "he_has_done_marvelous_things"];
    var songDirs = ["deep_river", "as",
                    "pretty_hurts", "get_lucky_the_few", "hymn_of_acxiom_the_few",
                    "good_news", "africa", "am_i_wrong", "do_you_hear"];

    function makePathToSongMetaData(root, name) {
        return root + name + "/index.json";
    }
    var allSongInfos = [[songDirs, 'sounds/'], [songDirsFree, 'sounds-free/']]
        .map(function (arr) {
            var names = arr[0],
                root = arr[1];
            return names.map(function (name) {
                return {
                    root: root,
                    name: name,
                    fullpath: makePathToSongMetaData(root, name)
                };
            });
        });
    return [].concat.apply([], allSongInfos);
}

function pickSong() {
    var selectedSongName = $('#song-select').val();
    var sis = getSongInfos();
    var selectedSongInfo = sis.find(
        function(si) {
            return si.name == selectedSongName;
        }
    );
    if (selectedSongInfo) {
        initialiseWithSong(selectedSongInfo);
        $('#song-select-row').hide();
    } else {
        //no song picked
        console.log("No (or unknown) song picked.");
    }
}

function initmp3mixer() {
    // Fix up prefixing
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    registerDOMControls();
    getSongInfos().forEach(function(si) {
        $("<option/>").val(si.name).text(si.name).appendTo("#song-select");
    });
}

function initialiseWithSong(chosenSongInfo) {

    function finishInit() {
        playbackRate = 1;
        useZeroCrossing = true;
        soloGroup = [];
        isPlaying = false;
        context = new AudioContext();
        bufferLoader = new BufferLoader(
            context,
            trackNames.map(function (n) {
                return chosenSongInfo.root + chosenSongInfo.name + "/" + n;
            }),
            finishedLoading
        );

        bufferLoader.load();

        window.setInterval(function () {
            $("#positionMonitor").val(computeCurrentTrackTime().toFixed(1));
        }, 1000);
    }

    function handleJSON(response) {
        var json = response;
        songTitle = json.title || "Untitled";
        $("#songTitle").html(songTitle);
        trackNames = json.tracks.map(function (t) {
            return t.name;
        });
        sectionStarts = json.sectionStarts || [];
        recreateSectionStartsInDOM();
        finishInit();
    }
    $.getJSON(chosenSongInfo.fullpath, handleJSON);
}

function getTrailingDigit(elem, prefix) {
    var l = prefix.length;
    var numstr = elem.id.substring(l, l + 1);
    return parseInt(numstr);
}

function getAllTrackIdsExcept(n) {
    var arr = getAllTrackIds();
    removeFromArray(arr, n);
    return arr;
}

//modifies the given array
function removeFromArray(arr, o) {
    var i = arr.indexOf(o);
    arr.splice(i, 1);
}

function getAllTrackIds() {
    var n = sourceAndGainPairs.length;
    var ids = [];
    for (var i = 0; i < n; i++) {
        ids.push(i);
    }
    return ids;
}

function getAllNonSoloTrackIds() {
    var all = getAllTrackIds();
    return all.filter(function (i) {
        return (soloGroup.indexOf(i) < 0);
    });
}

function tempMuteTrack(n) {
    var elem = $('#mute' + n);
    elem.addClass('mutebutton-muted-for-solo');
    setTrackGain(n, 0);
}

//TODO: integrate this quickly added fn.
function muteTrackNormally(n) {
    var elem = $('#mute' + n);
    elem.addClass('mutebutton-muted');
    setTrackGain(n, 0);
}

function setTrackGain(n, g) {
    var pair = sourceAndGainPairs[n];
    pair.gainNode.gain.cancelScheduledValues(context.currentTime);
    pair.gainNode.gain.value = g;
}

function handleSoloButton(elem) {
    console.log("Toggling solo on elem: " + elem.id);
    var n = getTrailingDigit(elem, "solo");
    if (soloGroup.indexOf(n) < 0) {
        toggleSoloOn(elem, n);
    } else {
        toggleSoloOff(elem, n);
    }
    elem.classList.toggle("solobutton-on");
}

function toggleSoloOff(elem, n) {
    console.log("toggle solo off for " + n);
    if (soloGroup.length < 2) {
        console.log("solo group ending");

        //unmute everything that has been muted-for-solo
        var toUnmute = getAllNonSoloTrackIds();
        console.log("non-solo tracks: " + toUnmute);
        toUnmute.forEach(function (i) {
            tempUnmuteTrack(i);
        });
    } else {
        tempMuteTrack(n);
    }
    removeFromArray(soloGroup, n);
}

function tempUnmuteTrack(i) {
    var elem = $('#mute' + i);
    elem.removeClass('mutebutton-muted-for-solo');
    setTrackGainUsingSliderAndMute(i);
}

function removeAnyMutingOnTrack(i) {
    var mb = $('#mute' + i);
    mb.removeClass('mutebutton-muted mutebutton-muted-for-solo');
}

function removeAnySoloingOnTrack(i) {
    var mb = $('#solo' + i);
    mb.removeClass('solobutton-on');
}

function trackIsMutedOrTempMuted(i) {
    var mb = $('#mute' + i);
    return  (mb.hasClass('mutebutton-muted') ||
        mb.hasClass('mutebutton-muted-for-solo'));
}

function setTrackGainUsingSlider(i) {
    var g = getVolumeSliderValueForTrack(i);
    setTrackGain(i, g);
}

function setTrackGainUsingSliderAndMute(i) {
    if (trackIsMutedOrTempMuted(i)) {
        setTrackGain(i, 0);
    } else {
        setTrackGainUsingSlider(i);
    }
}

function toggleSoloOn(elem, n) {
    if (soloGroup.length > 0) {
        console.log("adding " + n + " to existing solo group with " + soloGroup);
        tempUnmuteTrack(n);
    } else {
        var otherIds = getAllTrackIdsExcept(n);
        console.log("starting new solo group with " + n + " and temp-muting " + otherIds);
        otherIds.forEach(tempMuteTrack);
    }
    soloGroup.push(n);
}

function handleMuteButton(elem) {
    console.log("Toggling mute on elem: " + elem.id);
    var n = getTrailingDigit(elem, "mute");
    var pair = sourceAndGainPairs[n];
    pair.gainNode.gain.cancelScheduledValues(context.currentTime);
    console.log("before: " + pair.gainNode.gain.value + " and classes " + elem.classList);

    if (elem.classList.contains("mutebutton-muted")) {
        if (!elem.classList.contains("mutebutton-muted-for-solo")) {
            setTrackGainUsingSlider(n);
        } else {
            //still muted for solo
        }
    } else {
        //wasn't muted.  mute it.
        pair.gainNode.gain.value = 0;
    }
    elem.classList.toggle("mutebutton-muted");
    console.log("after: " + pair.gainNode.gain.value + " and classes " + elem.classList);
}

function createSourceOnBuffer(b) {
    var src = context.createBufferSource();
    src.playbackRate.value = 1;
    src.buffer = b;
    return src;
}

function createGainedSourceOnBuffer(b) {
    var src = createSourceOnBuffer(b);
    var analyser = context.createAnalyser();
    analyser.fftSize = fftConfig.size;
    var bufferLength = analyser.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);

    var gainNode = linkThroughGain(src);
    gainNode.connect(analyser);

    return {
        title: b,
        src: src,
        gainNode: gainNode,
        analyser: analyser,
        dataArray: dataArray
    };
}

function createAllGainedSourcesOnBuffers(bufferList) {
    sourceAndGainPairs = bufferList.map(function (buf) {
        return createGainedSourceOnBuffer(buf);
    });
}

function simpleTrackName(i) {
    var input = trackNames[i];
    return input.substr(0, input.lastIndexOf('.')) || input;
}

function makeControlsForTrack(buf, i) {

    var group = $("<p/>", {
        id: "controlrow" + i,
        class: "sliderrow"
    });
    var label = $("<label/>", {
        text: simpleTrackName(i),
        title: trackNames[i]
    }); //TODO: sanitise track names for security
    var muteButton = $("<button/>", {
        id: "mute" + i,
        class: "mutebutton btn btn-default"
    }).append("<i class='fa fa-volume-off'></i>");
    var soloButton = $("<button/>", {
        id: "solo" + i,
        class: "solobutton btn btn-default"
    }).append("<i class='fa fa-headphones'></i>");
    var slider = $("<input/>", {
        type: "range",
        id: "vol" + i,
        value: "100",
        class: "slider",
        min: "0",
        max: "100",
        title: "Change volume of " + trackNames[i]
    });
    var canvas = $("<canvas/>", {
        id: "trackCanvas" + i,
        width: '500',
        height: '100'
    });

    group.append(label);
    group.append(muteButton);
    group.append(soloButton);
    group.append(slider);
    group.append(canvas);
    $("#controlset").append(group);

    $('#vol' + i).on('change', function () {
        handleChangeVolumeSlider(this);
    });
    $('#mute' + i).on('click', function () {
        handleMuteButton(this);
    });
    $('#solo' + i).on('click', function () {
        handleSoloButton(this);
    });

}

function registerDOMControls() {
    $('#positionSlider').on('input', function () {
        handleChangePosition(this);
    });
    $('#playbackRateSlider').on('input', function () {
        handleChangePlaybackRate(this);
    });
    $('#playButton').on('click', function () {
        play();
    });
    $('#pickSongButton').on('click', function () {
        pickSong();
    });
    $('#stopButton').on('click', function () {
        stopAndDestroyAll();
    });
    $('#snapshotButton').on('click', function () {
        snapshotTime();
    });
    $('#clearButton').on('click', function () {
        clearMix();
    });
    $('#randomiseButton').on('click', function () {
        randomiseMix();
    });
}
function createControlsInDOM(bufferList) {
    bufferList.forEach(function (buf, i) {
        makeControlsForTrack(buf, i);
    });
}

function finishedLoading(bufferList) {
    gBufferList = bufferList;
    // Create three sources and play them both together.
    createAllGainedSourcesOnBuffers(bufferList);
    createControlsInDOM(bufferList);

    //play();
}

function wipeAllNodes() {
    sourceAndGainPairs = [];
}

function linkThroughGain(src) {
    var gainNode = context.createGain();
    src.connect(gainNode);
    gainNode.connect(context.destination);
    gainNode.gain.value = 1;
    return gainNode;
}

function getVolumeSliderValueForTrack(i) {
    return getVolumeSliderValueFrom0To1($('#vol' + i).get()[0]);
}

function getVolumeSliderValueFrom0To1(elem) {
    return (parseFloat(elem.value) / 100);
}

//TODO: integrate this quick hack
function setVolumeSliderValueForTrack(i, val) {
    $('#vol' + i).val(val);
}

//expected an input html element with id "vol1" or "vol2", and value from 0 to 100.
function handleChangeVolumeSlider(elem) {
    //TODO: volume changes while no sources loaded must be allowed, and must persist when sources are reloaded (e.g. play position changed and all recreated).
    // The gain nodes won't necessarily exist?  Perhaps: hold a proxy for each gain setting, and map this on play() to the gain node, as well as immediately on slider changes, if applicable.
    var i = getTrailingDigit(elem, "vol");
    if (!trackIsMutedOrTempMuted(i)) {
        var g = getVolumeSliderValueFrom0To1(elem);
        setTrackGain(i, g);
    }
}

function lengthOfFirstBufferInSec() {
    return sourceAndGainPairs[0].src.buffer.duration;
}

function handleChangePosition(elem) {
    updatePosOffset(convertSliderValueToSeconds(elem));
}

function handleChangePlaybackRate(elem) {
    updatePlaybackRate(parseFloat(elem.value));
}

function convertSliderValueToSeconds(elem) {
    return Math.round(lengthOfFirstBufferInSec() * parseFloat(elem.value) / parseInt(elem.max));
}

function stopAndDestroyAll() {
    playStartedTime = -1;
    var firstSource = sourceAndGainPairs[0].src;
    if (firstSource !== null) {
        sourceAndGainPairs.forEach(function (pair) {
            if (pair.src !== null) {
                pair.src.stop(0);
            }
        });
        isPlaying = false;
        wipeAllNodes();
    }
}

function setAllSourcesToLoop(shouldLoop) {
    sourceAndGainPairs.forEach(function (pair) {
        pair.src.loop = shouldLoop;
    });
}

function drawAllAnims() {

    var sharedCanvas = document.getElementById('trackCanvas' + 0);
    var canvasCtx = sharedCanvas.getContext('2d');
    canvasCtx.fillStyle = 'white';
    canvasCtx.fillRect(0, 0, sharedCanvas.width, sharedCanvas.height);

    sourceAndGainPairs.forEach(function (pair, i) {
        drawOneFFT(pair.analyser, pair.dataArray, i);
    });

    if (numFrames >= 0) {
        requestAnimationFrame(drawAllAnims);
        numFrames += 1;
    }

}

var MINVAL = 134; // 128 == zero.  MINVAL is the "minimum detected signal" level.


function findFirstPositiveZeroCrossing(buf, buflen) {
    var i = 0;
    var last_zero = -1;
    var t;

    // advance until we're zero or negative
    while (i < buflen && (buf[i] > 128)) {
        i++;
    }

    if (i >= buflen) {
        return 0;
    }
    // advance until we're above MINVAL, keeping track of last zero.
    while (i < buflen && ((t = buf[i]) < MINVAL)) {
        if (t >= 128) {
            if (last_zero === -1) {
                last_zero = i;
            }
        } else {
            last_zero = -1;
        }
        i++;
    }

    // we may have jumped over MINVAL in one sample.
    if (last_zero === -1) {
        last_zero = i;
    }

    if (i == buflen) { // We didn't find any positive zero crossings
        return 0;
    }

    // The first sample might be a zero.  If so, return it.
    if (last_zero === 0) {
        return 0;
    }

    return last_zero;
}

function drawOneFFT(analyser, dataArray, i, sharedCanvas, yOffset) {
    var canvasElem = sharedCanvas || document.getElementById('trackCanvas' + i);

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

    for (var j = 0; j < len; j++) {
        var val = dataArray[j] * vertScale;
        scaledVals.push(val);
    }

    if (fftConfig.type === "spectrum") {
        drawSpectrum(canvasCtx, scaledVals, stripeWidth, canvasWidth, canvasHeight, yOffset);
    } else if (fftConfig.type === "waveform") {
        if (signalAboveThreshold(dataArray)) {
            if (useZeroCrossing) {
                var zeroCross = findFirstPositiveZeroCrossing(dataArray, canvasWidth);
                drawWaveformAtZeroCrossing(canvasCtx, scaledVals, stripeWidth, canvasWidth, canvasHeight, yOffset, zeroCross);
            } else {
                drawWaveform(canvasCtx, scaledVals, stripeWidth, canvasWidth, canvasHeight, yOffset);
            }
        }
    } else { // no fft

    }
}

function signalAboveThreshold(arr) {
    var threshold = 3;

    for (var i = 0; i < arr.length; i += 1) {
        var val = arr[i];
        if (Math.abs(128 - val) > threshold) {
            return true;
        }
    }
    return false;

}

function drawSpectrum(canvasCtx, scaledVals, stripeWidth, w, h, yOffset) {
    canvasCtx.globalAlpha = 0.5;

    canvasCtx.fillStyle = 'rgb(255, 0, 0)';
    scaledVals.forEach(function (v, i) {
        canvasCtx.fillRect(i * stripeWidth, h - v + yOffset, stripeWidth, v);
    });
}

function drawWaveform(canvasCtx, scaledVals, step, w, h, yOffset) {
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = 'rgb(0, 0, 0)';
    canvasCtx.beginPath();
    var x = 0;

    scaledVals.forEach(function (v, i) {
        var y = v + yOffset;
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += step;
    });
    canvasCtx.stroke();
}


function drawWaveformAtZeroCrossing(canvasCtx, scaledVals, step, w, h, yOffset, zeroCross) {

    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = 'rgb(0, 0, 0)';
    canvasCtx.beginPath();

    canvasCtx.moveTo(0, scaledVals[zeroCross]);

    for (var i = zeroCross, j = 0;
        (j < w) && (i < scaledVals.length); i++, j++) {
        canvasCtx.lineTo(j, (scaledVals[i]));
    }

    canvasCtx.stroke();
}

function play() {
    if (isPlaying) {
        stopAndDestroyAll();
        isPlaying = false;
    }
    createAllGainedSourcesOnBuffers(gBufferList);
    setAllSourcesToLoop(true);
    setPlaybackRateForAllSources(playbackRate);

    getAllTrackIds().forEach(function (i) {
        setTrackGainUsingSliderAndMute(i);
    });

    playStartedTime = context.currentTime;
    playStartedOffset = posOffset;
    sourceAndGainPairs.forEach(function (pair) {
        pair.src.start(0, posOffset);
    });
    requestAnimationFrame(drawAllAnims);

    isPlaying = true;
}

function setPlaybackRateForAllSources(r) {
    sourceAndGainPairs.forEach(function (pair) {
        pair.src.playbackRate.value = r;
    });
}

function computeCurrentTrackTime() {
    if (playStartedTime < 0) {
        return -1;
    } else {
        var elapsedSecs = context.currentTime - playStartedTime;
        return playStartedOffset + elapsedSecs;
    }
}

function clearMix() {
    //TODO: encapsulate control of soloing, muting, and solo-groups.
    soloGroup = [];
    getAllTrackIds().forEach(function (id) {
        removeAnyMutingOnTrack(id);
        removeAnySoloingOnTrack(id);
        setVolumeSliderValueForTrack(id, 100);
        setTrackGainUsingSlider(id);
    });
}

function randomIntBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function randomiseMix() {
    clearMix();
    var allTrackIds = getAllTrackIds();

    function howManyTracksToInclude(totalNum) {
        var min = Math.min(1, totalNum);
        var max = Math.max(1, totalNum - 1);
        return randomIntBetween(min, max);
    }
    var numTracksToInclude = howManyTracksToInclude(allTrackIds.length);
    var trackIdsToMute = _.shuffle(allTrackIds).slice(numTracksToInclude);
    trackIdsToMute.forEach(muteTrackNormally);
}

function snapshotTime() {
    if (playStartedTime < 0) {
        //TODO: implement so we can snapshot whenever
        console.log("ERROR: can't yet snapshot time when stopped");
    } else {
        var trackTime = +(computeCurrentTrackTime().toFixed(1));
        var label = $('#snapshotName').val() || "untitled";
        sectionStarts.push({
            time: trackTime,
            label: label
        });
        recreateSectionStartsInDOM();
        $('#snapshotName').val("");
    }
}

function updatePlaybackRate(val) {
    playbackRate = val;
    $("#playbackRateOutput").val(playbackRate);
}

function updatePosOffset(val) {
    posOffset = val;
    $("#positionOutput").val(posOffset);
}

function jumpToSection(i) {
    //var val = convertSecondsToSliderValue(sectionStarts[i]);
    var secs = sectionStarts[i].time;
    updatePosOffset(secs);
    play();
    //TODO: update slider to reflect new position
}

function recreateSectionStartsInDOM() {
    $('#snapshots').html("");

    function makeSnapshotElement(s, i) {
        var timeText = "" + Math.round(s.time) + "s";
        var labelSpan = $('<button/>', {
            class: "btn btn-default btn-sm",
            text: s.label + " @ " + timeText
        });
        var listItem = $('<li/>', {
            class: "sectionStart",
            id: "sectionStart" + i
        });
        listItem.append(labelSpan);
        return listItem;
    }

    sectionStarts.forEach(function (s, i) {
        $('#snapshots').append(makeSnapshotElement(s, i));
        $('#sectionStart' + i).on('click', function () {
            jumpToSection(i);
        });
    });
}

function playPrevSectionStart() {}
function cycleSoloPrevTrack() {}
function playNextSectionStart() {}
function cycleSoloNextTrack() {}

$(document).keydown(function (evt) {
    //console.log([evt.which, evt.target.nodeName]);
    if(evt.target.nodeName != 'INPUT' && evt.target.nodeName != 'TEXTAREA') {
        //TODO: perhaps only grab keypresses targetted on BODY?
        //  We want arrows to work on sliders.  Input and Textarea already have special needs, too.
        switch (evt.keyCode) {
            case 37:
                playPrevSectionStart();
                break;
            case 38:
                cycleSoloPrevTrack();
                break;
            case 39:
                playNextSectionStart();
                break;
            case 40:
                cycleSoloNextTrack();
                break;
            case 82:
                randomiseMix();
                break;
            case 32:
            case 80:
                play();//prevent propagation - space will scroll screen normally.
                break;
            default:
                break;
        }
    }
});

$(document).ready(initmp3mixer);

}());
