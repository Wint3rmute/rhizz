component "tire" {
  description = "A 24in bicycle tire"
  leaf = true
}

component "wheel" {
  description = "A spinning round object"
  instance "tire" {source = "tire"}
}

component "fork" {
  description = "Holds the front wheel"
  leaf = true
}

component "frame"  {
  description = "main component of a bicycle"
  leaf = true
}

system "bicycle" {
  description = "Personal transport vehicle"

  instance "front-wheel" {source = "wheel"}
  instance "rear-wheel" {source = "wheel"}
  instance "fork" {source = "fork"}
  instance "frame" {source = "frame"}

  connection "front-wheel-mount" {
    description = "keeps the front wheel attached"
    from = "./front-wheel"
    to = "fork"
  }

  connection "rear-wheel-mount" {
    description = "keeps the rear wheel attached"
    from = "./rear-wheel"
    to = "./frame"
  }

  connection "fork-mount" {
    description = "bearing connecting the fork to the frame"
    from = "./fork"
    to = "./frame"
  }
}
