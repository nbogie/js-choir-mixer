require 'json'

items = {}
tracks = []
Dir.glob("*.mp3") do |f|
  track = {:name => f}
  tracks.push(track)
end
items["tracks"] = tracks
items["title"] = "title goes here"

puts(JSON.generate(items))
