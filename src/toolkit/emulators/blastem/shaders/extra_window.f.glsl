
uniform sampler2D texture;

varying mediump vec2 texcoord;

void main()
{
	gl_FragColor = texture2D(texture, texcoord);
}
