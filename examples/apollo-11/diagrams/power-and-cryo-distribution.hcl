view "power-and-cryo-distribution" {
  description = "Cryogenic reactant storage, SM fuel cells, and 28V DC power distribution"
  system      = "apollo-11"

  filter {
    include_tags  = ["power", "cryo"]
  }
}
