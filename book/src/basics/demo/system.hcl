component "tire" {
  full_name = "A 24in bicycle tire"
  leaf = true
}

component "wheel" {
  full_name = "A spinning round object"
  instance "tire" {source = "tire"}

  port "mount" {
    role = "peer"
  }
}

component "fork" {
  full_name = "Holds the front wheel"
  leaf = true

  port "mount" {
    role = "peer"
  }
}

component "frame"  {
  full_name = "main component of a bicycle"
  leaf = true

  port "mount" {
    role = "peer"
  }
}

system "bicycle" {
  full_name = "Personal transport vehicle"

  instance "front-wheel" {source = "wheel"}
  instance "rear-wheel" {source = "wheel"}
  instance "fork" {source = "fork"}
  instance "frame" {source = "frame"}

  connection "front-wheel-mount" {
    full_name = "keeps the front wheel attached"
    from = "./front-wheel/mount"
    to = "fork/mount"
  }

  connection "rear-wheel-mount" {
    full_name = "keeps the rear wheel attached"
    from = "./rear-wheel/mount"
    to = "./frame/mount"
  }

  connection "fork-mount" {
    full_name = "bearing connecting the fork to the frame"
    from = "./fork/mount"
    to = "./frame/mount"
  }
}
