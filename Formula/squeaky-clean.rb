class SqueakyClean < Formula
  desc "Smart, safe, configurable cache cleaner CLI for 25+ dev tools"
  homepage "https://github.com/chendrizzy/squeaky-clean"
  url "https://registry.npmjs.org/squeaky-clean/-/squeaky-clean-0.6.5.tgz"
  sha256 "35c678a582d5f2e77fba2ef862868295e5eccb43e778411d1254ee89de717465"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/squeaky --version")
    assert_match version.to_s, output
  end
end
